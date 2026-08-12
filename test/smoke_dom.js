// DOM-stub smoke test: load all UI scripts in browser order and ensure no load-time errors.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function makeEl() {
  const target = function () {};
  const proxy = new Proxy(target, {
    get(t, prop) {
      if (prop === 'style') return new Proxy({}, { get: () => '', set: () => true });
      if (prop === 'classList') return { add() {}, remove() {}, contains() { return false; }, toggle() {} };
      if (prop === 'dataset') return {};
      if (prop === 'textContent' || prop === 'innerHTML' || prop === 'value') return '';
      if (prop === 'getContext') return () => makeEl();
      if (prop === 'getBoundingClientRect') return () => ({ width: 360, height: 780, left: 0, top: 0 });
      if (prop === 'addEventListener' || prop === 'removeEventListener' || prop === 'setAttribute' ||
          prop === 'appendChild' || prop === 'removeChild' || prop === 'focus' || prop === 'remove') return () => {};
      if (prop === 'querySelector' || prop === 'closest') return () => makeEl();
      if (prop === 'querySelectorAll') return () => [];
      if (prop === Symbol.toPrimitive) return () => '';
      return makeEl();
    },
    set() { return true; },
    apply() { return makeEl(); },
  });
  return proxy;
}

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

global.window = global;
global.addEventListener = () => {};
global.document = {
  getElementById: () => makeEl(),
  querySelector: () => makeEl(),
  querySelectorAll: () => [],
  createElement: () => makeEl(),
  addEventListener: () => {},
  head: makeEl(),
  body: makeEl(),
};
global.localStorage = storage;
global.sessionStorage = storage;
global.location = { search: '?mode=flip&opp=human&level=normal&side=black' };
global.navigator = { userAgent: 'node' };
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = () => 0; // no-op: don't run animation loops
global.devicePixelRatio = 1;
// AudioContext intentionally undefined -> sound.js degrades gracefully

const base = path.join(__dirname, '..', 'www', 'js');
const files = ['board.js', 'pieces.js', 'engine.js', 'ai.js', 'presets.js', 'common.js', 'settings.js', 'sound.js'];
for (const f of files) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
}
// page scripts (each wraps its own IIFE and runs at load)
for (const f of ['home.js', 'layout.js', 'game.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(base, f), 'utf8'), { filename: f });
  console.log('loaded OK:', f);
}
console.log('SMOKE OK');
