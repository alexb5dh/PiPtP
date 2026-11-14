// Playerjs ignores volume change wihout API, so its bar doesn't follow
(() => {
  document.removeEventListener('pip-subs-volume', window.__pipSubsPlayerjs);
  window.__pipSubsPlayerjs = e => {
    const pip = window.documentPictureInPicture?.window?.document;
    const spot = document.querySelector('[data-pip-subs-placeholder]');
    if (!pip || !spot) return;
    // The moved player: its container went to PiP, or stayed on the page around the placeholder.
    const player = window.pljssglobal?.find(p => {
      const id = p?.api('id');
      return id && (pip.getElementById(id) || document.getElementById(id)?.contains(spot));
    });
    if (!player) return;
    const { volume, muted } = JSON.parse(e.detail);
    try {
      player.api('volume', volume);
      if (muted) player.api('mute');
      e.preventDefault();
    } catch {}
  };
  document.addEventListener('pip-subs-volume', window.__pipSubsPlayerjs);
})();
