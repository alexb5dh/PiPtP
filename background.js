// The shortcut is `_execute_action`, so it lands here too.
chrome.action.onClicked.addListener(tab => toggle(tab.id));

// One call keeps the user gesture; pip.js skips re-init if already loaded.
async function toggle(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['pip.js', 'toggle.js'] });
  } catch (e) {
    console.warn('pip-subs:', e);
  }
}
