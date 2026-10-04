/**
 * Minimal canvas + 2D context stub.
 *
 * It records draw calls so the real compositor code (overlay.js, staticmap.js,
 * capture.js) can be exercised in Node, and it can pretend to be tainted so the
 * export-safe fallback path is testable.
 */

export function createCanvasStub(width, height, { tainted = false } = {}) {
  const calls = [];

  const ctx = {
    tainted,
    calls,
    measureText(text) {
      return { width: String(text ?? '').length * 6 };
    },
    getImageData() {
      if (ctx.tainted) throw new Error('SecurityError: the canvas has been tainted');
      return { data: new Uint8ClampedArray([0, 0, 0, 255]) };
    },
    createLinearGradient() {
      return { addColorStop() {} };
    },
    drawImage(...args) {
      calls.push({ method: 'drawImage', args });
    },
    fillText(...args) {
      calls.push({ method: 'fillText', args });
    },
    fillRect(...args) {
      calls.push({ method: 'fillRect', args });
    },
    strokeRect(...args) {
      calls.push({ method: 'strokeRect', args });
    },
  };

  const context = new Proxy(ctx, {
    get(target, prop) {
      if (prop in target) return target[prop];
      return (...args) => {
        calls.push({ method: String(prop), args });
      };
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });

  const canvas = {
    width,
    height,
    getContext: () => context,
    toBlob(callback, type, quality) {
      calls.push({ method: 'toBlob', args: [type, quality] });
      callback(new Blob(['#'.repeat(2048)], { type: type ?? 'image/jpeg' }));
    },
    toDataURL(type) {
      return `data:${type ?? 'image/png'};base64,AAAA`;
    },
  };

  ctx.canvas = canvas;
  return { canvas, ctx: context, calls };
}

/**
 * @param {(w:number,h:number,index:number)=>boolean} [taintIf] mark matching
 *   canvases tainted. `index` is the creation order, so a test can taint the
 *   tile canvas while leaving the fallback canvas clean.
 */
export function createCanvasFactory({ taintIf } = {}) {
  const made = [];
  const factory = (width, height) => {
    const index = made.length;
    const stub = createCanvasStub(width, height, { tainted: Boolean(taintIf?.(width, height, index)) });
    made.push(stub);
    return stub.canvas;
  };
  factory.made = made;
  return factory;
}

/** Resolves to a fake tile image, counting how many were requested. */
export function createTileStub({ fail = false, size = 256 } = {}) {
  const requested = [];
  const loadTile = async (z, x, y) => {
    requested.push({ z, x, y });
    if (fail) throw new Error(`tile ${z}/${x}/${y} unavailable`);
    return { width: size, height: size, complete: true };
  };
  loadTile.requested = requested;
  return loadTile;
}

export function createVideoStub(width = 4032, height = 3024) {
  return { videoWidth: width, videoHeight: height, readyState: 4 };
}

export function callsOf(calls, method) {
  return calls.filter((call) => call.method === method);
}
