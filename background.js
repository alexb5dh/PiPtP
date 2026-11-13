// The shortcut is `_execute_action`, so it lands here too.
chrome.action.onClicked.addListener(tab => toggle(tab.id));

// Both calls start in the same task, keeping the user gesture; pip.js skips re-init if already loaded.
async function toggle(tabId) {
  const target = { tabId, allFrames: true };
  try {
    await Promise.all([
      chrome.scripting.executeScript({ target, files: ['main.js'], world: 'MAIN' }),
      chrome.scripting.executeScript({ target, files: ['pip-ui.js', 'pip.js', 'toggle.js'] }),
    ]);
  } catch (e) {
    console.warn('pip-subs:', e);
  }
}

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
