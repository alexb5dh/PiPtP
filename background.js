// The shortcut is `_execute_action`, so it lands here too.
chrome.action.onClicked.addListener(tab => toggle(tab.id));

// Both calls start in the same task, keeping the user gesture; pip.js skips re-init if already loaded.
async function toggle(tabId) {
  const target = { tabId, allFrames: true };
  try {
    await Promise.all([
      chrome.scripting.executeScript({ target, files: ['main.js', 'players/playerjs.js'], world: 'MAIN' }),
      chrome.scripting.executeScript({ target, files: ['pip-ui.js', 'pip.js', 'toggle.js'] }),
    ]);
  } catch (e) {
    console.warn('pip-subs:', e);
  }
}

// Option "Replace site PiP buttons" (icon menu checkbox): when on, all pages load override.js and the PiP code.
const OVERRIDE = 'override-site-pip';
const OVERRIDE_SCRIPTS = [
  { id: 'override-main', matches: ['<all_urls>'], allFrames: true, runAt: 'document_start', world: 'MAIN', js: ['main.js', 'override.js', 'players/playerjs.js'] },
  { id: 'override-pip', matches: ['<all_urls>'], allFrames: true, runAt: 'document_idle', js: ['pip-ui.js', 'pip.js'] },
];

async function applyOverride(on) {
  const ids = OVERRIDE_SCRIPTS.map(s => s.id);
  const registered = (await chrome.scripting.getRegisteredContentScripts({ ids })).map(s => s.id);
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered });
  if (on) await chrome.scripting.registerContentScripts(OVERRIDE_SCRIPTS);
}

// Icon menu checkboxes, stored under their ids; pip.js reads 'pause-on-exit'.
const OPTIONS = { [OVERRIDE]: 'Replace site PiP buttons', 'pause-on-exit': 'Pause on exit' };

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(Object.keys(OPTIONS));
  for (const [id, title] of Object.entries(OPTIONS)) {
    chrome.contextMenus.create({ id, title, type: 'checkbox', checked: !!stored[id], contexts: ['action'] });
  }
  await applyOverride(!!stored[OVERRIDE]);
});

chrome.contextMenus.onClicked.addListener(async info => {
  if (!(info.menuItemId in OPTIONS)) return;
  await chrome.storage.local.set({ [info.menuItemId]: info.checked });
  if (info.menuItemId === OVERRIDE) await applyOverride(info.checked);
});

// Window drag from pip-ui.js. The PiP window is found by its bounds at drag start; moves are coalesced.
let dragWindow = Promise.resolve(null), pending = null, busy = false;

chrome.runtime.onMessage.addListener(m => {
  if (m.type === 'pip-drag-start') dragWindow = findWindow(m);
  else if (m.type === 'pip-drag') {
    pending = { left: m.left, top: m.top };
    pump();
  }
});

async function findWindow({ left, top, width, height }) {
  const near = (a, b, d) => Math.abs(a - b) <= d;
  const windows = await chrome.windows.getAll();
  return windows.find(w => near(w.left, left, 2) && near(w.top, top, 2) && near(w.width, width, 4) && near(w.height, height, 4))?.id ?? null;
}

async function pump() {
  if (busy) return;
  busy = true;
  while (pending) {
    const pos = pending;
    pending = null;
    const id = await dragWindow;
    if (id != null) await chrome.windows.update(id, pos).catch(() => {});
  }
  busy = false;
}
