(() => {
  // No runtime id: left over from before an extension reload, so replace it.
  if (window.__pipSubs && globalThis.chrome?.runtime?.id) return;

  const MIN_W = 160, MIN_H = 90;
  let session = null;

  function* allVideos(root = document) {
    yield* root.querySelectorAll('video');
    for (const el of root.querySelectorAll('*')) if (el.shadowRoot) yield* allVideos(el.shadowRoot);
  }

  function visibleArea(el) {
    const r = el.getBoundingClientRect();
    const w = Math.min(r.right, innerWidth) - Math.max(r.left, 0);
    const h = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0);
    return w > 0 && h > 0 ? w * h : 0;
  }

  function findVideo() {
    let best = null, bestScore = 0;
    for (const v of allVideos()) {
      const r = v.getBoundingClientRect();
      if (r.width < MIN_W || r.height < MIN_H || v.readyState === 0) continue;
      const score = visibleArea(v) * (v.paused ? 1 : 4);
      if (score > bestScore) { best = v; bestScore = score; }
    }
    return best;
  }

  const up = el => el.parentElement ?? el.parentNode?.host ?? null;

  // Highest video-sized ancestor: holds subs/controls, not the page.
  // Custom elements may reset when moved: crossed only as a shadow host or the video's direct wrapper.
  function findPlayerBox(video) {
    const vr = video.getBoundingClientRect();
    let box = video;
    for (let el = up(video); el && el !== document.body && el !== document.documentElement; el = up(el)) {
      const isHost = el.shadowRoot != null && box.getRootNode() === el.shadowRoot;
      if (el.localName.includes('-') && box !== video && !isHost) break;
      const r = el.getBoundingClientRect();
      if (r.width > vr.width + 8 || r.height > vr.height * 1.25 + 64) break;
      box = el;
    }
    return box;
  }

  function sheetText(sheet, depth = 0) {
    let rules;
    try { rules = sheet.cssRules; } catch { return null; }
    const parts = [];
    for (const rule of rules) {
      if (rule instanceof CSSImportRule) {
        const inner = depth < 8 && rule.styleSheet ? sheetText(rule.styleSheet, depth + 1) : null;
        if (inner == null) continue;
        const media = rule.media?.mediaText;
        parts.push(media ? `@media ${media} {\n${inner}\n}` : inner);
      } else {
        parts.push(rule.cssText);
      }
    }
    return parts.join('\n');
  }

  function sheetsSignature(node) {
    return sourceSheets(node).map(s => {
      try { return `${s.href}:${s.cssRules.length}`; } catch { return `${s.href}:x`; }
    }).join('|');
  }

  // Constructed sheets: page CSP may block <style>.
  const rootSheets = root => [...root.styleSheets, ...(root.adoptedStyleSheets ?? [])];

  // A box inside a shadow root needs that root's styles too.
  function sourceSheets(node) {
    const sheets = rootSheets(document);
    for (let root = node.getRootNode(); root instanceof ShadowRoot; root = root.host.getRootNode()) sheets.push(...rootSheets(root));
    return sheets;
  }

  function syncStyles(win, node, ownSheets) {
    const doc = win.document;
    doc.querySelectorAll('link[data-pip-subs]').forEach(l => l.remove());
    const adopted = [];
    for (const sheet of sourceSheets(node)) {
      if (sheet.disabled) continue;
      const text = sheetText(sheet);
      if (text == null) {
        if (!sheet.href) continue;
        const link = doc.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        if (sheet.media?.mediaText) link.media = sheet.media.mediaText;
        link.dataset.pipSubs = '';
        doc.head.append(link);
        continue;
      }
      const copy = new win.CSSStyleSheet({ baseURL: sheet.href || document.baseURI, media: sheet.media?.mediaText || '' });
      copy.replaceSync(text);
      adopted.push(copy);
    }
    doc.adoptedStyleSheets = [...adopted, ...ownSheets];
  }

  // `:is(x, #_#_#_)`: matches x with 3-id specificity, beats site !important rules.
  const strong = sel => `:is(${sel}, #_#_#_)`;

  const FILL = {
    display: 'block', position: 'relative', inset: 'auto', width: '100%', height: '100%', 'min-width': '0', 'min-height': '0',
    'max-width': 'none', 'max-height': 'none', margin: '0', padding: '0', border: '0', transform: 'none', overflow: 'hidden',
  };
  const FILL_VIDEO = { ...FILL, position: 'absolute', left: '0', top: '0', 'object-fit': 'contain' };
  const css = props => Object.entries(props).map(([k, v]) => `${k}: ${v} !important;`).join(' ');

  function baseSheet(win) {
    const shell = strong('html, body, [data-pip-subs-shell]');
    const s = new win.CSSStyleSheet();
    s.replaceSync(`
      ${shell} { ${css(FILL)} visibility: visible !important; float: none !important; zoom: 1 !important; background: #000 !important; }
      ${shell}::before, ${shell}::after { content: none !important; display: none !important; }
      ${strong('[data-pip-subs-fill]')} { ${css(FILL)} }
      ${strong('video[data-pip-subs-fill]')} { ${css(FILL_VIDEO)} }
    `);
    return s;
  }

  // Fill mode: stretch to the window, the player re-lays out. Returns undo; shadow-root parts get inline styles.
  function markFill(box, video) {
    const undo = [];
    for (let el = video; el; el = el === box ? null : up(el)) {
      if (el.getRootNode() instanceof ShadowRoot) {
        const style = el.getAttribute('style');
        for (const [k, v] of Object.entries(el === video ? FILL_VIDEO : FILL)) el.style.setProperty(k, v, 'important');
        undo.push(() => (style == null ? el.removeAttribute('style') : el.setAttribute('style', style)));
      } else if (!el.hasAttribute('data-pip-subs-fill')) {
        el.setAttribute('data-pip-subs-fill', '');
        undo.push(() => el.removeAttribute('data-pip-subs-fill'));
      }
    }
    return () => undo.forEach(f => f());
  }

  // Centers of the player's smaller parts relative to its size; full-size layers say nothing about the layout.
  function partsLayout(parts, box) {
    const b = box.getBoundingClientRect();
    return parts.map(e => {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.width * r.height > b.width * b.height / 2) return null;
      return [(r.left + r.width / 2 - b.left) / b.width, (r.top + r.height / 2 - b.top) / b.height];
    });
  }

  // After a 1.6x stretch, fixed-px parts keep their px positions, so their relative centers move a lot.
  function movedParts(before, after) {
    let n = 0, moved = 0;
    before.forEach((p, i) => {
      const q = after[i];
      if (!p || !q) return;
      n++;
      if (Math.abs(p[0] - q[0]) > 0.1 || Math.abs(p[1] - q[1]) > 0.1) moved++;
    });
    return { n, moved };
  }

  // Briefly stretches the player (hidden) far from its page size to see whether its layout follows.
  // Opacity, not visibility: parts with their own `visibility: visible` would still show.
  async function probeResponsive(sheet, box, parts, before, g) {
    sheet.replaceSync(`${strong('[data-pip-subs-probe]')} { width: ${g.w * 1.6}px !important; height: ${g.h * 1.6}px !important;
      opacity: 0 !important; }`);
    box.setAttribute('data-pip-subs-probe', '');
    nudgeLayout();
    await new Promise(r => setTimeout(r, 250));
    const stats = movedParts(before, partsLayout(parts, box));
    box.removeAttribute('data-pip-subs-probe');
    sheet.replaceSync('');
    return { ...stats, responsive: stats.n === 0 || stats.moved / stats.n < 0.3 };
  }

  // Blocker hiding rules aren't in document.styleSheets: re-hide what showed up. Returns undo.
  function rehide(hidden) {
    const undo = [];
    for (const el of hidden) {
      if (el.ownerDocument.defaultView.getComputedStyle(el).display === 'none') continue;
      const value = el.style.getPropertyValue('display'), priority = el.style.getPropertyPriority('display');
      el.style.setProperty('display', 'none', 'important');
      undo.push(() => (value ? el.style.setProperty('display', value, priority) : el.style.removeProperty('display')));
    }
    return () => undo.forEach(f => f());
  }

  const linksLoaded = doc => Promise.all([...doc.querySelectorAll('link[data-pip-subs]')].map(l => new Promise(done => {
    l.addEventListener('load', done);
    l.addEventListener('error', done);
    setTimeout(done, 2000);
  })));

  // Scale mode (fixed-px players): only the video grows; the rest keeps its on-page size.
  // `g`: box size, video offset/size in it. dpr ratio: same on-screen size if the PiP window renders at another scale.
  function fitBox(sheet, win, g) {
    const W = win.innerWidth, H = win.innerHeight;
    const k = Math.min(1, window.devicePixelRatio / win.devicePixelRatio, W / g.w, H / g.h);
    const s = Math.min(W / g.vw, H / g.vh);
    const vx = (W - g.vw * s) / 2, vy = (H - g.vh * s) / 2;
    const clamp = (v, max) => Math.max(0, Math.min(v, max));
    const bx = clamp(W / 2 - (g.vx + g.vw / 2) * k, W - g.w * k), by = clamp(vy + g.vh * s - (g.vy + g.vh) * k, H - g.h * k);
    const tx = (vx - bx) / k - g.vx, ty = (vy - by) / k - g.vy;
    sheet.replaceSync(`
      ${strong('[data-pip-subs-box]')} { position: absolute !important; inset: 0 auto auto 0 !important;
        width: ${g.w}px !important; height: ${g.h}px !important; min-width: 0 !important; min-height: 0 !important;
        max-width: none !important; max-height: none !important; margin: 0 !important; box-sizing: border-box !important;
        transform-origin: 0 0 !important; transform: translate(${bx}px, ${by}px) scale(${k}) !important; }
      ${strong('[data-pip-subs-unclip]')} { overflow: visible !important; contain: none !important; clip-path: none !important; }
      ${strong('video[data-pip-subs-unclip]')} { transform-origin: 0 0 !important;
        transform: translate(${tx}px, ${ty}px) scale(${s / k}) !important; }
    `);
    return { k, x: bx, y: by, w: g.w, h: g.h, video: { l: vx, t: vy, r: vx + g.vw * s, b: vy + g.vh * s } };
  }

  const EDGE = 0.25;

  // Scale mode, box smaller than the video: move its top/center parts (PiP, play buttons) to the video's top/center.
  // `translate` composes with the player's transforms. Bottom and off-center parts stay with the control bar.
  function edgeAnchors(win, box, video) {
    const applied = new Map();
    let frame = null, raf = 0;
    const movedAncestor = el => {
      for (let p = el.parentElement; p && p !== box; p = p.parentElement) if (applied.has(p)) return true;
      return false;
    };
    // Offset in box px for a part, from its position without our offset; null: leave it.
    function offset(el, f, d) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return applied.get(el) ?? null;
      const [ax, ay] = applied.get(el)?.xy ?? [0, 0];
      const w = r.width / f.k, h = r.height / f.k;
      const x = (r.left - f.x) / f.k - ax, y = (r.top - f.y) / f.k - ay;
      if (w * h > (f.w * f.h) / 4 || x < -4 || y < -4 || x + w > f.w + 4 || y + h > f.h + 4) return null;
      const cx = (x + w / 2) / f.w, cy = (y + h / 2) / f.h;
      const side = cx < EDGE ? d.left : cx > 1 - EDGE ? d.right : 0;
      if (cy < EDGE) return { xy: [side, d.top] };
      if (cy <= 1 - EDGE && !side) return { xy: [0, d.middle] };
      return null;
    }
    function update() {
      raf = 0;
      const f = frame;
      if (!f) return;
      const d = {
        left: (f.video.l - f.x) / f.k, right: (f.video.r - f.x - f.w * f.k) / f.k, top: (f.video.t - f.y) / f.k,
        middle: ((f.video.t + f.video.b) / 2 - f.y - (f.h * f.k) / 2) / f.k,
      };
      for (const el of box.querySelectorAll('*')) {
        if (el === video || el.contains(video) || movedAncestor(el)) continue;
        const o = offset(el, f, d);
        if (!o || (!o.xy[0] && !o.xy[1])) {
          if (applied.delete(el)) el.style.removeProperty('translate');
          continue;
        }
        applied.set(el, o);
        const value = `${o.xy[0]}px ${o.xy[1]}px`;
        if (el.style.getPropertyValue('translate') !== value) el.style.setProperty('translate', value, 'important');
      }
    }
    const schedule = () => (raf ||= win.requestAnimationFrame(update));
    const observer = new MutationObserver(schedule);
    observer.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] });
    return {
      update(f) { frame = f; schedule(); },
      stop() {
        observer.disconnect();
        for (const el of applied.keys()) el.style.removeProperty('translate');
      },
    };
  }

  // The grown video must not be clipped by the player's own boxes. Returns undo.
  function unclip(box, video) {
    const marked = [];
    for (let el = video; el; el = el === box ? null : up(el)) {
      el.setAttribute('data-pip-subs-unclip', '');
      marked.push(el);
    }
    return () => marked.forEach(el => el.removeAttribute('data-pip-subs-unclip'));
  }

  // Inline styles keep CSS variables and fonts; !important dropped so shell rules win.
  function copyAttributes(from, to) {
    for (const a of from.attributes) to.setAttribute(a.name, a.value);
    for (const name of [...to.style]) {
      if (to.style.getPropertyPriority(name)) to.style.setProperty(name, to.style.getPropertyValue(name));
    }
  }

  // Empty ancestor copies keep descendant selectors matching.
  function buildShell(doc, box) {
    copyAttributes(document.documentElement, doc.documentElement);
    copyAttributes(document.body, doc.body);
    let parent = doc.body;
    const chain = [];
    for (let el = up(box); el && el !== document.body; el = up(el)) chain.unshift(el);
    for (const el of chain) {
      const shell = doc.createElement(el.localName);
      copyAttributes(el, shell);
      shell.setAttribute('data-pip-subs-shell', '');
      parent.append(shell);
      parent = shell;
    }
    return parent;
  }

  function makePlaceholder(box) {
    const r = box.getBoundingClientRect();
    const cs = getComputedStyle(box);
    const ph = document.createElement('div');
    ph.textContent = 'Playing in Picture-in-Picture';
    Object.assign(ph.style, {
      width: `${r.width}px`, height: `${r.height}px`, position: cs.position === 'static' ? 'relative' : cs.position,
      top: cs.top, left: cs.left, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', color: '#aaa', font: '16px sans-serif', boxSizing: 'border-box',
    });
    return ph;
  }

  const MODS = ['ctrlKey', 'shiftKey', 'altKey', 'metaKey'];
  const KEY = [KeyboardEvent, ['key', 'code', 'keyCode', 'which', 'charCode', 'location', 'repeat', ...MODS]];
  const MOUSE_PROPS = ['clientX', 'clientY', 'screenX', 'screenY', 'movementX', 'movementY', 'button', 'buttons', 'detail', ...MODS];
  const MOUSE = [MouseEvent, MOUSE_PROPS];
  const POINTER = [PointerEvent, [...MOUSE_PROPS, 'pointerId', 'pointerType', 'isPrimary', 'width', 'height', 'pressure']];
  const FORWARDED = {
    keydown: KEY, keyup: KEY, mousemove: MOUSE, mouseup: MOUSE, pointermove: POINTER, pointerup: POINTER, pointercancel: POINTER,
  };

  // PiP events never reach the page's document-level handlers (shortcuts, slider drags): re-dispatch there.
  // `frame`: scaled box, coords go unscaled like main.js reports them.
  function forward(e, target, frame) {
    const [Type, props] = FORWARDED[e.type];
    const init = Object.fromEntries(props.map(k => [k, e[k]]));
    if (frame && 'clientX' in init) {
      init.clientX = frame.x + (init.clientX - frame.x) / frame.k;
      init.clientY = frame.y + (init.clientY - frame.y) / frame.k;
    }
    const copy = new Type(e.type, { ...init, bubbles: true, cancelable: true, composed: true, view: window });
    target.dispatchEvent(copy);
    return copy.defaultPrevented;
  }

  // Player's own handlers (moved with it) first, then the page's, then ours.
  async function onKey(e, video) {
    if (e.defaultPrevented) return;
    if (forward(e, document.body ?? document.documentElement)) return e.preventDefault();
    const action = e.type === 'keydown' && ownAction(e, video);
    if (!action) return;
    e.preventDefault();
    // Sites often handle keys without preventDefault(): act only if the video didn't react.
    const before = videoState(video);
    await new Promise(r => setTimeout(r, 200));
    if (!reacted(before, video)) action();
  }

  const videoState = v => ({ paused: v.paused, time: v.currentTime, at: performance.now(), volume: v.volume, muted: v.muted });

  function reacted(s, v) {
    const expected = s.time + (s.paused ? 0 : ((performance.now() - s.at) / 1000) * v.playbackRate);
    return v.paused !== s.paused || v.volume !== s.volume || v.muted !== s.muted || v.seeking || Math.abs(v.currentTime - expected) > 1;
  }

  function ownAction(e, video) {
    if (e.ctrlKey || e.metaKey || e.altKey) return null;
    const toggle = () => (video.paused ? video.play() : video.pause());
    return {
      ' ': toggle,
      k: toggle,
      ArrowLeft: () => (video.currentTime -= 5),
      ArrowRight: () => (video.currentTime += 5),
      ArrowUp: () => (video.volume = Math.min(1, video.volume + 0.1)),
      ArrowDown: () => (video.volume = Math.max(0, video.volume - 0.1)),
      m: () => (video.muted = !video.muted),
    }[e.key] ?? null;
  }

  const nudgeLayout = () => window.dispatchEvent(new Event('resize'));

  async function open(video = findVideo()) {
    if (!video) return;
    if (!window.documentPictureInPicture || window !== window.top) {
      return document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture();
    }
    const box = findPlayerBox(video);
    const r = box.getBoundingClientRect();
    const width = Math.round(Math.min(640, r.width));
    const height = Math.round(width * (r.height / r.width));

    let win;
    try {
      win = await documentPictureInPicture.requestWindow({ width, height });
    } catch (e) {
      if (e.name === 'NotAllowedError') return offerButton(video);
      throw e;
    }

    const vr = video.getBoundingClientRect();
    const geo = vr.width && vr.height
      ? { w: r.width, h: r.height, vx: vr.left - r.left, vy: vr.top - r.top, vw: vr.width, vh: vr.height }
      : { w: r.width, h: r.height, vx: 0, vy: 0, vw: r.width, vh: r.height };
    const fitSheet = new win.CSSStyleSheet();
    let frame = null, anchors = null, ui = null;
    const fit = () => {
      frame = fitBox(fitSheet, win, geo);
      box.setAttribute('data-pip-subs-frame', `${frame.k},${frame.x},${frame.y}`);
      anchors?.update(frame);
      ui?.layout();
    };
    const ownSheets = [baseSheet(win), fitSheet];
    syncStyles(win, box, ownSheets);
    const host = buildShell(win.document, box);
    const placeholder = makePlaceholder(box);
    const wasPlaying = !video.paused;
    const parts = [...box.querySelectorAll('*')].filter(e => e !== video);
    const hidden = parts.filter(e => getComputedStyle(e).display === 'none');
    const sample = parts.slice(0, 400);
    const before = partsLayout(sample, box);
    box.before(placeholder);
    let undoMode = markFill(box, video);
    host.append(box);
    if (wasPlaying && video.paused) video.play().catch(() => {});
    nudgeLayout();

    let unhide = () => {};
    linksLoaded(win.document).then(() => (unhide = rehide(hidden)));

    let scaled = false, closed = false;
    probeResponsive(fitSheet, box, sample, before, geo).then(probe => {
      nudgeLayout();
      if (!probe.responsive && !closed) {
        scaled = true;
        undoMode();
        const undoClip = unclip(box, video);
        anchors = edgeAnchors(win, box, video);
        undoMode = () => { anchors.stop(); undoClip(); };
        box.setAttribute('data-pip-subs-box', '');
        fit();
      }
      console.info('pip-subs', JSON.stringify({ mode: scaled ? 'scale' : 'fill', probe, frame, box: box.id || box.className,
        geo, win: [win.innerWidth, win.innerHeight], dpr: [window.devicePixelRatio, win.devicePixelRatio] }));
    });
    const onResize = () => (scaled ? fit() : nudgeLayout());

    let signature = sheetsSignature(placeholder);
    const timer = setInterval(() => {
      const s = sheetsSignature(placeholder);
      if (s !== signature) { signature = s; syncStyles(win, placeholder, ownSheets); }
    }, 1000);
    const key = e => onKey(e, video);
    win.addEventListener('keydown', key);
    win.addEventListener('keyup', key);
    for (const type of Object.keys(FORWARDED)) {
      if (!type.startsWith('key')) win.addEventListener(type, e => forward(e, document, frame));
    }
    win.addEventListener('resize', onResize);
    ui = window.__pipSubsUi?.attach(win, video);
    // The site's PiP button inside the window: its request bubbles to this document.
    win.document.addEventListener('pip-subs-request', e => window.__pipSubsRequest?.(e));

    session = {
      win,
      close() {
        clearInterval(timer);
        closed = true;
        const playing = !video.paused;
        undoMode();
        unhide();
        box.removeAttribute('data-pip-subs-box');
        box.removeAttribute('data-pip-subs-frame');
        placeholder.replaceWith(box);
        if (playing && video.paused) video.play().catch(() => {});
        session = null;
        setTimeout(nudgeLayout, 50);
      },
    };
    win.addEventListener('pagehide', () => session?.close(), { once: true });
  }

  // Fallback when the shortcut gave no user gesture.
  function offerButton(video) {
    const r = video.getBoundingClientRect();
    const btn = document.createElement('button');
    btn.textContent = 'Open PiP with subtitles';
    Object.assign(btn.style, {
      position: 'fixed', zIndex: 2147483647, left: `${r.left + 12}px`, top: `${r.top + 12}px`,
      padding: '8px 12px', font: '14px sans-serif', background: '#1a73e8', color: '#fff', border: 0, borderRadius: '6px',
      cursor: 'pointer',
    });
    const remove = () => btn.remove();
    btn.addEventListener('click', () => { remove(); open(); });
    setTimeout(remove, 5000);
    document.documentElement.append(btn);
  }

  window.__pipSubs = {
    toggle() {
      if (session) return session.win.close();
      if (document.pictureInPictureElement) return document.exitPictureInPicture();
      return open();
    },
  };

  // From override.js: a site's PiP button asked for PiP on this video. Replaces the listener of a previous load.
  document.removeEventListener('pip-subs-request', window.__pipSubsRequest);
  window.__pipSubsRequest = e => {
    const video = e.composedPath()[0];
    if (video?.localName !== 'video') return;
    e.preventDefault();
    if (session) session.win.close();
    else open(video);
  };
  document.addEventListener('pip-subs-request', window.__pipSubsRequest);
})();
