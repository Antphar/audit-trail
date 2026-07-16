/** Browser globals shim for Node — import before any game module. */

let _query = process.env.NODE_SIM_QUERY ?? "headless=1&external=1&mode=battle";

export function initSimEnv({ query } = {}) {
  if (query !== undefined) _query = query;
  installGlobals();
}

function noopEl() {
  const el = {
    classList: { add() {}, remove() {}, toggle() {} },
    style: {},
    value: "",
    textContent: "",
    innerText: "",
    innerHTML: "",
    children: [],
    childNodes: [],
    addEventListener() {},
    removeEventListener() {},
    appendChild() { return noopEl(); },
    removeChild() {},
    setAttribute() {},
    getAttribute: () => null,
    focus() {},
    click() {},
    getContext: () => ({
      scale() {}, fillRect() {}, clearRect() {}, drawImage() {},
      save() {}, restore() {}, translate() {}, rotate() {},
      fill() {}, stroke() {}, beginPath() {}, moveTo() {}, lineTo() {},
      arc() {}, setTransform() {}, measureText: () => ({ width: 0 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    }),
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }),
  };
  return new Proxy(el, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (typeof prop === "symbol") return undefined;
      return noopEl();
    },
  });
}

function installGlobals() {
  const search = _query.startsWith("?") ? _query : `?${_query}`;
  const storage = new Map();

  globalThis.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };

  globalThis.requestAnimationFrame = (cb) => {
    setImmediate(() => cb(performance.now()));
    return 1;
  };
  globalThis.cancelAnimationFrame = () => {};

  globalThis.location = {
    search,
    href: `http://localhost/audit-trail/index.html${search}`,
    pathname: "/audit-trail/index.html",
    hostname: "localhost",
    protocol: "http:",
  };

  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.devicePixelRatio = 1;
  globalThis.innerWidth = 800;
  globalThis.innerHeight = 600;
  globalThis.AudioContext = undefined;
  globalThis.webkitAudioContext = undefined;
  globalThis.window = globalThis;

  const body = noopEl();
  globalThis.document = new Proxy({
    body,
    head: noopEl(),
    documentElement: noopEl(),
    createElement: () => noopEl(),
    getElementById: () => noopEl(),
    querySelector: () => noopEl(),
    querySelectorAll: () => [],
    addEventListener: () => {},
    removeEventListener: () => {},
  }, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === "getElementById" || prop === "querySelector") return () => noopEl();
      if (prop === "querySelectorAll") return () => [];
      return undefined;
    },
  });
}

initSimEnv();
