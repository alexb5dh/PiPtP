(() => {
  if (window.__pipSubs) return;

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

  // Highest video-sized ancestor: holds subs/controls, not the page.
  function findPlayerBox(video) {
    const vr = video.getBoundingClientRect();
    let box = video;
    for (let el = video.parentElement; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
      if (el.localName.includes('-')) break;
      const r = el.getBoundingClientRect();
      if (r.width > vr.width * 1.1 + 24 || r.height > vr.height * 1.25 + 64) break;
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

  function sheetsSignature() {
    const items = [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])];
    return items.map(s => {
      try { return `${s.href}:${s.cssRules.length}`; } catch { return `${s.href}:x`; }
    }).join('|');
  }

  // Constructed sheets: page CSP may block <style>.
  function syncStyles(win) {
    const doc = win.document;
    doc.querySelectorAll('link[data-pip-subs]').forEach(l => l.remove());
    const adopted = [];
    for (const sheet of [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])]) {
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
    adopted.push(ownSheet(win));
    doc.adoptedStyleSheets = adopted;
  }

  // `:is(x, #_#_#_)`: matches x with 3-id specificity, beats site !important rules.
  function ownSheet(win) {
    const strong = sel => `:is(${sel}, #_#_#_)`;
    const fill = strong('html, body, [data-pip-subs-shell], [data-pip-subs-fill]');
    const shell = strong('html, body, [data-pip-subs-shell]');
    const s = new win.CSSStyleSheet();
    s.replaceSync(`
      ${fill} { display: block !important; position: relative !important; inset: auto !important;
        width: 100% !important; height: 100% !important; min-width: 0 !important; min-height: 0 !important;
        max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
        border: 0 !important; transform: none !important; overflow: hidden !important; visibility: visible !important;
        float: none !important; zoom: 1 !important; }
      ${shell} { background: #000 !important; }
      ${shell}::before, ${shell}::after { content: none !important; display: none !important; }
      ${strong('video[data-pip-subs-fill]')} { position: absolute !important; left: 0 !important; top: 0 !important;
        object-fit: contain !important; }
    `);
    return s;
  }

  function copyAttributes(from, to) {
    for (const a of from.attributes) if (a.name !== 'style') to.setAttribute(a.name, a.value);
  }

  // Empty ancestor copies keep descendant selectors matching.
  function buildShell(doc, box) {
    copyAttributes(document.documentElement, doc.documentElement);
    copyAttributes(document.body, doc.body);
    let parent = doc.body;
    const chain = [];
    for (let el = box.parentElement; el && el !== document.body; el = el.parentElement) chain.unshift(el);
    for (const el of chain) {
      const shell = doc.createElement(el.localName);
      copyAttributes(el, shell);
      shell.setAttribute('data-pip-subs-shell', '');
      parent.append(shell);
      parent = shell;
    }
    return parent;
  }

  function markFill(box, video) {
    const marked = [];
    for (let el = video; el; el = el === box ? null : el.parentElement) {
      if (!el.hasAttribute('data-pip-subs-fill')) {
        el.setAttribute('data-pip-subs-fill', '');
        marked.push(el);
      }
    }
    return marked;
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

  function onKey(e, video) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const handled = {
      ' ': () => (video.paused ? video.play() : video.pause()),
      k: () => (video.paused ? video.play() : video.pause()),
      ArrowLeft: () => (video.currentTime -= 5),
      ArrowRight: () => (video.currentTime += 5),
      ArrowUp: () => (video.volume = Math.min(1, video.volume + 0.1)),
      ArrowDown: () => (video.volume = Math.max(0, video.volume - 0.1)),
      m: () => (video.muted = !video.muted),
    }[e.key];
    if (!handled) return;
    e.preventDefault();
    e.stopPropagation();
    handled();
  }

  const nudgeLayout = () => window.dispatchEvent(new Event('resize'));

  async function open() {
    const video = findVideo();
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

    syncStyles(win);
    const host = buildShell(win.document, box);
    const placeholder = makePlaceholder(box);
    const wasPlaying = !video.paused;
    box.before(placeholder);
    const marked = markFill(box, video);
    host.append(box);
    if (wasPlaying && video.paused) video.play().catch(() => {});

    let signature = sheetsSignature();
    const timer = setInterval(() => {
      const s = sheetsSignature();
      if (s !== signature) { signature = s; syncStyles(win); }
    }, 1000);
    const key = e => onKey(e, video);
    win.addEventListener('keydown', key, true);
    win.addEventListener('resize', nudgeLayout);
    setTimeout(nudgeLayout, 50);

    session = {
      win,
      close() {
        clearInterval(timer);
        const playing = !video.paused;
        marked.forEach(el => el.removeAttribute('data-pip-subs-fill'));
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
})();
