// Page world, option "Replace site PiP buttons": a site's requestPictureInPicture opens the player PiP (pip.js) instead.
(() => {
  if (window.__pipSubsOverride || window !== window.top || !window.documentPictureInPicture) return;
  window.__pipSubsOverride = true;

  const native = HTMLVideoElement.prototype.requestPictureInPicture;
  HTMLVideoElement.prototype.requestPictureInPicture = function () {
    // pip.js (isolated world) handles it; the site's click still counts as the user gesture there.
    const handled = !this.dispatchEvent(new CustomEvent('pip-subs-request', { bubbles: true, composed: true, cancelable: true }));
    if (!handled) return native.call(this);
    // Sites await a PictureInPictureWindow; none exists for the document PiP.
    return Promise.resolve({ width: 0, height: 0, onresize: null, addEventListener() {}, removeEventListener() {} });
  };
})();
