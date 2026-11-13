chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-pip' && tab?.id) toggle(tab.id);
});
chrome.action.onClicked.addListener(tab => toggle(tab.id));

// One call for all frames keeps the user gesture.
async function toggle(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__pipSubs?.toggle(),
    });
  } catch (e) {
    console.warn('pip-subs:', e);
  }
}
