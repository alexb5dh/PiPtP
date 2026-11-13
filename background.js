// The shortcut is `_execute_action`, so it lands here too.
chrome.action.onClicked.addListener(tab => toggle(tab.id));

// Both calls start in the same task, keeping the user gesture; pip.js skips re-init if already loaded.
async function toggle(tabId) {
  const target = { tabId, allFrames: true };
  try {
    await Promise.all([
      chrome.scripting.executeScript({ target, files: ['main.js'], world: 'MAIN' }),
      chrome.scripting.executeScript({ target, files: ['pip.js', 'toggle.js'] }),
    ]);
  } catch (e) {
    console.warn('pip-subs:', e);
  }
}
