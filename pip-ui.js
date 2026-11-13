// PiP window extras, like Chrome's own video PiP: drag the video to move the window, click its sides to seek.
// Both act only on the picture itself: controls and text (subtitles) drawn over it keep their clicks.
(() => {
  if (window.__pipSubsUi && globalThis.chrome?.runtime?.id) return;

  const SEEK_SECONDS = 10;
  const ZONE_WIDTH = 0.3;
  const DRAG_THRESHOLD = 4;
  const INTERACTIVE = 'a, button, input, select, textarea, label, [role="button"], [role="slider"], [contenteditable]';

  const send = message => chrome.runtime.sendMessage(message).catch(() => {});

  // Video picture or a full-size layer over it; not text (subtitles) or controls.
  function isPicture(el, video) {
    if (el?.nodeType !== 1) return false;
    if (el === video) return true;
    if (el.closest(INTERACTIVE)) return false;
    if ([...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
    const r = el.getBoundingClientRect(), v = video.getBoundingClientRect();
    return r.width * r.height >= (v.width * v.height) / 2;
  }

  // Video rect clipped to the window.
  function videoRect(win, video) {
    const v = video.getBoundingClientRect();
    return { l: Math.max(0, v.left), t: Math.max(0, v.top), r: Math.min(win.innerWidth, v.right), b: Math.min(win.innerHeight, v.bottom) };
  }

  // -1/1: left/right seek zone at the point, 0: none.
  function sideAt(win, video, x, y) {
    const v = videoRect(win, video), w = (v.r - v.l) * ZONE_WIDTH;
    if (y < v.t || y > v.b) return 0;
    return x >= v.l && x < v.l + w ? -1 : x > v.r - w && x <= v.r ? 1 : 0;
  }

  const CSS = `
    :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
    .zone { position: fixed; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
      color: #fff; font: 600 12px system-ui, sans-serif; opacity: 0; transition: opacity .15s; }
    .zone.shown { opacity: .5; }
    .zone.hover { opacity: 1; }
    .left { background: radial-gradient(ellipse at left center, rgba(255,255,255,.4), rgba(255,255,255,0) 75%), rgba(0,0,0,.2); }
    .right { background: radial-gradient(ellipse at right center, rgba(255,255,255,.4), rgba(255,255,255,0) 75%), rgba(0,0,0,.2); }
    .zone svg { width: 28px; height: 28px; filter: drop-shadow(0 0 2px rgba(0,0,0,.8)); }
    .zone span { text-shadow: 0 0 3px rgba(0,0,0,.9); }
    .zone.flash { animation: flash .35s ease-out; }
    @keyframes flash { from { background-color: rgba(255,255,255,.35); } }
  `;

  function arrow(doc, dir) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = doc.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = doc.createElementNS(ns, 'path');
    path.setAttribute('d', dir < 0 ? 'M11 6l-6 6 6 6M19 6l-6 6 6 6' : 'M13 6l6 6-6 6M5 6l6 6-6 6');
    for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '2.2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) {
      path.setAttribute(k, v);
    }
    svg.append(path);
    return svg;
  }

  // Visual only (pointer-events: none): clicks are handled on the window, so controls on top still get theirs.
  function zoneGlows(win, video) {
    const doc = win.document;
    const host = doc.createElement('pip-subs-ui');
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    const glows = new Map([-1, 1].map(dir => {
      const glow = doc.createElement('div');
      glow.className = `zone ${dir < 0 ? 'left' : 'right'}`;
      const label = doc.createElement('span');
      label.textContent = `${SEEK_SECONDS}`;
      glow.append(arrow(doc, dir), label);
      root.append(glow);
      return [dir, glow];
    }));
    doc.body.append(host);

    function layout() {
      const v = videoRect(win, video), w = (v.r - v.l) * ZONE_WIDTH;
      for (const [dir, glow] of glows) {
        Object.assign(glow.style, { left: `${dir < 0 ? v.l : v.r - w}px`, top: `${v.t}px`, width: `${w}px`, height: `${v.b - v.t}px` });
      }
    }
    layout();
    win.addEventListener('resize', () => win.requestAnimationFrame(layout));
    const timer = setInterval(layout, 1000);
    win.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    return {
      layout,
      // side: zone under the pointer (0: picture between zones), null: pointer not on the picture.
      hover: side => glows.forEach((glow, dir) => {
        glow.classList.toggle('shown', side != null);
        glow.classList.toggle('hover', dir === side);
      }),
      flash(side) {
        const glow = glows.get(side);
        glow.classList.remove('flash');
        void glow.offsetWidth;
        glow.classList.add('flash');
      },
    };
  }

  // Drag on the picture moves the window; a click on it inside a side zone seeks. The page can't move a PiP window
  // (moveBy is ignored there), so drag positions go to the background, which uses chrome.windows.
  function pictureGestures(win, video, glows) {
    let press = null, swallow = false, raf = 0, pos = null;
    const flush = () => {
      raf = 0;
      send({ type: 'pip-drag', ...pos });
    };
    const seek = side => {
      const end = Number.isFinite(video.duration) ? video.duration : Infinity;
      video.currentTime = Math.max(0, Math.min(end, video.currentTime + side * SEEK_SECONDS));
      glows.flash(side);
    };
    // The player must not see presses we own: zone clicks and drags would toggle play.
    const stop = e => {
      e.stopImmediatePropagation();
      e.preventDefault();
    };

    win.addEventListener('pointerdown', e => {
      const target = e.composedPath()[0];
      if (e.button !== 0 || !isPicture(target, video)) return;
      const side = sideAt(win, video, e.clientX, e.clientY);
      press = { x: e.screenX, y: e.screenY, left: win.screenX, top: win.screenY, target, pointerId: e.pointerId, side, dragging: false };
      if (side) stop(e);
    }, true);
    win.addEventListener('mousedown', e => press?.side && stop(e), true);

    win.addEventListener('pointermove', e => {
      if (!press) {
        glows.hover(isPicture(e.composedPath()[0], video) ? sideAt(win, video, e.clientX, e.clientY) : null);
        return;
      }
      const dx = e.screenX - press.x, dy = e.screenY - press.y;
      if (!press.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        press.dragging = true;
        glows.hover(null);
        send({ type: 'pip-drag-start', left: press.left, top: press.top, width: win.outerWidth, height: win.outerHeight });
        try { press.target.setPointerCapture(press.pointerId); } catch {}
      }
      pos = { left: Math.round(press.left + dx), top: Math.round(press.top + dy) };
      raf ||= win.requestAnimationFrame(flush);
    }, true);
    win.document.documentElement.addEventListener('mouseleave', () => glows.hover(null));

    win.addEventListener('pointerup', e => {
      if (!press) return;
      const { dragging, side } = press;
      press = null;
      if (!dragging && side) seek(side);
      swallow = dragging || !!side;
      if (swallow) {
        stop(e);
        setTimeout(() => (swallow = false), 300);
      }
    }, true);
    for (const type of ['mouseup', 'click', 'dblclick']) win.addEventListener(type, e => swallow && stop(e), true);
  }

  window.__pipSubsUi = {
    attach(win, video) {
      const glows = zoneGlows(win, video);
      pictureGestures(win, video, glows);
      return glows;
    },
  };
})();
