// Page world. Shrunk players mix scaled rects/clientX with unscaled offsetWidth: report both unscaled inside the box.
(() => {
  if (window.__pipSubsMain) return;
  window.__pipSubsMain = true;

  // data-pip-subs-frame="k,x,y": box scale and its top-left in the window.
  function frameOf(node) {
    for (let el = node; el; el = el.parentElement ?? el.getRootNode?.().host) {
      const f = el.nodeType === 1 && el.getAttribute('data-pip-subs-frame');
      if (f) {
        const [k, x, y] = f.split(',').map(Number);
        return k > 0 && k !== 1 ? { k, x, y } : null;
      }
    }
    return null;
  }

  const unscale = (v, origin, k) => origin + (v - origin) / k;

  function patch(win) {
    const proto = win.Element.prototype;
    const rect = proto.getBoundingClientRect;
    proto.getBoundingClientRect = function () {
      const r = rect.call(this), f = frameOf(this);
      return f ? new win.DOMRect(unscale(r.x, f.x, f.k), unscale(r.y, f.y, f.k), r.width / f.k, r.height / f.k) : r;
    };
    const mouse = win.MouseEvent.prototype;
    for (const [prop, axis] of [['clientX', 'x'], ['clientY', 'y'], ['pageX', 'x'], ['pageY', 'y'], ['x', 'x'], ['y', 'y']]) {
      const get = Object.getOwnPropertyDescriptor(mouse, prop)?.get;
      if (!get) continue;
      Object.defineProperty(mouse, prop, {
        configurable: true,
        get() {
          const v = get.call(this), f = this.target?.nodeType === 1 && frameOf(this.target);
          return f ? unscale(v, f[axis], f.k) : v;
        },
      });
    }
  }

  patch(window);
  // Event and element wrappers may come from the PiP window's realm too.
  window.documentPictureInPicture?.addEventListener('enter', e => patch(e.window));
})();
