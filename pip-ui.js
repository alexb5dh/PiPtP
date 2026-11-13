// PiP window extras, like Chrome's own video PiP: drag the video to move the window, click the side zones to seek.
(() => {
  if (window.__pipSubsUi && globalThis.chrome?.runtime?.id) return;

  const SEEK_SECONDS = 10;
  const DRAG_THRESHOLD = 4;
  const IDLE_MS = 2500;
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

  // The page can't move a PiP window (moveBy is ignored there); the background does it through chrome.windows.
  function enableDrag(win, video, isZone) {
    let start = null, dragging = false, swallow = false, raf = 0, pos = null;
    const flush = () => {
      raf = 0;
      send({ type: 'pip-drag', ...pos });
    };
    win.addEventListener('pointerdown', e => {
      const target = e.composedPath()[0];
      if (e.button !== 0 || !(isZone(target) || isPicture(target, video))) return;
      start = { x: e.screenX, y: e.screenY, left: win.screenX, top: win.screenY, target, pointerId: e.pointerId };
      dragging = false;
    }, true);
    win.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.screenX - start.x, dy = e.screenY - start.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        send({ type: 'pip-drag-start', left: start.left, top: start.top, width: win.outerWidth, height: win.outerHeight });
        try { start.target.setPointerCapture(start.pointerId); } catch {}
      }
      pos = { left: Math.round(start.left + dx), top: Math.round(start.top + dy) };
      raf ||= win.requestAnimationFrame(flush);
    }, true);
    win.addEventListener('pointerup', e => {
      if (!start) return;
      swallow = dragging;
      start = null;
      dragging = false;
      if (swallow) {
        e.stopImmediatePropagation();
        setTimeout(() => (swallow = false), 300);
      }
    }, true);
    // A drag must not reach the player as a click (play/pause).
    for (const type of ['mouseup', 'click']) {
      win.addEventListener(type, e => {
        if (!swallow) return;
        e.stopImmediatePropagation();
        e.preventDefault();
      }, true);
    }
  }

  const CSS = `
    :host { all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; }
    .zone { position: fixed; pointer-events: auto; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 4px; color: #fff; font: 600 12px system-ui, sans-serif; cursor: pointer; user-select: none;
      opacity: 0; transition: opacity .15s, background-color .15s; }
    :host(.active) .zone { opacity: .55; }
    .zone:hover { opacity: 1 !important; }
    .left { background: radial-gradient(ellipse at left center, rgba(255,255,255,.4), rgba(255,255,255,0) 75%) no-repeat;
      background-size: 0 0; }
    .right { background: radial-gradient(ellipse at right center, rgba(255,255,255,.4), rgba(255,255,255,0) 75%) no-repeat;
      background-size: 0 0; }
    .zone:hover { background-size: 100% 100%; background-color: rgba(0,0,0,.2); }
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
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2.2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);
    return svg;
  }

  // Side zones over the video's middle half: clear of control bars, corner buttons and the center play button.
  function seekZones(win, video) {
    const doc = win.document;
    const host = doc.createElement('pip-subs-ui');
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new win.CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
    const zones = [-1, 1].map(dir => {
      const zone = doc.createElement('div');
      zone.className = `zone ${dir < 0 ? 'left' : 'right'}`;
      const label = doc.createElement('span');
      label.textContent = `${SEEK_SECONDS}`;
      zone.append(arrow(doc, dir), label);
      zone.addEventListener('click', e => {
        e.stopPropagation();
        const end = Number.isFinite(video.duration) ? video.duration : Infinity;
        video.currentTime = Math.max(0, Math.min(end, video.currentTime + dir * SEEK_SECONDS));
        zone.classList.remove('flash');
        void zone.offsetWidth;
        zone.classList.add('flash');
      });
      root.append(zone);
      return zone;
    });
    doc.body.append(host);

    let idle = 0;
    const wake = () => {
      host.classList.add('active');
      clearTimeout(idle);
      idle = setTimeout(() => host.classList.remove('active'), IDLE_MS);
    };
    doc.addEventListener('mousemove', wake, true);
    doc.documentElement.addEventListener('mouseleave', () => host.classList.remove('active'));

    function layout() {
      const v = video.getBoundingClientRect();
      const left = Math.max(0, v.left), right = Math.min(win.innerWidth, v.right);
      const top = Math.max(0, v.top), bottom = Math.min(win.innerHeight, v.bottom);
      const w = Math.min(140, Math.max(48, (right - left) * 0.15)), h = (bottom - top) / 2;
      zones.forEach((zone, i) => Object.assign(zone.style, {
        left: `${i ? right - w : left}px`, top: `${top + h / 2}px`, width: `${w}px`, height: `${h}px`,
      }));
    }
    layout();
    win.addEventListener('resize', () => win.requestAnimationFrame(layout));
    const timer = setInterval(layout, 1000);
    win.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    // Outside the closed shadow root, events on the zones target the host.
    return { layout, isZone: el => el === host };
  }

  window.__pipSubsUi = {
    attach(win, video) {
      const zones = seekZones(win, video);
      enableDrag(win, video, zones.isZone);
      return zones;
    },
  };
})();
