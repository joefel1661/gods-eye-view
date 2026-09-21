import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateLogoGaze,
  initLogoGaze,
  LOGO_PART_SELECTORS,
} from './logoGaze.js';

const rect = { left: 100, top: 50, width: 80, height: 40 };

test('logo gaze is neutral when the cursor is centered', () => {
  assert.deepEqual(calculateLogoGaze(140, 70, rect), { x: 0, y: 0 });
});

test('logo gaze follows direction and caps at the requested offset', () => {
  const gaze = calculateLogoGaze(1140, 70, rect, 28);
  assert.ok(Math.abs(gaze.x - 28) < 1e-9);
  assert.equal(gaze.y, 0);
});

test('logo gaze uses the more visible default travel', () => {
  const gaze = calculateLogoGaze(1140, 70, rect);
  assert.ok(Math.abs(gaze.x - 34) < 1e-9);
  assert.equal(gaze.y, 0);
});

test('logo gaze ramps proportionally inside the full-gaze distance', () => {
  const gaze = calculateLogoGaze(300, 70, rect, 28);
  assert.ok(Math.abs(gaze.x - 14) < 1e-9);
  assert.equal(gaze.y, 0);
});

test('logo gaze preserves diagonal direction while staying bounded', () => {
  const gaze = calculateLogoGaze(640, 570, rect, 28);
  assert.ok(Math.abs(Math.hypot(gaze.x, gaze.y) - 28) < 1e-9);
  assert.ok(gaze.x > 0);
  assert.ok(gaze.y > 0);
});

test('logo gaze fails closed for invalid geometry', () => {
  assert.deepEqual(calculateLogoGaze(10, 10, { ...rect, width: 0 }), {
    x: 0,
    y: 0,
  });
  assert.deepEqual(calculateLogoGaze(Number.NaN, 10, rect), { x: 0, y: 0 });
});

test('logo gaze initializes the current SAUGOPS ribbon selectors', async () => {
  const listeners = new Map();
  const upperRibbon = {
    transforms: [],
    setAttribute(name, value) {
      if (name === 'transform') this.transforms.push(value);
    },
  };
  const lowerRibbon = {
    transforms: [],
    setAttribute(name, value) {
      if (name === 'transform') this.transforms.push(value);
    },
  };

  const createSvg = () => ({
    removeAttribute() {},
    setAttribute() {},
    querySelector(selector) {
      if (selector === 'title') return { remove() {} };
      if (selector === LOGO_PART_SELECTORS[0]) return upperRibbon;
      if (selector === LOGO_PART_SELECTORS[1]) return lowerRibbon;
      return null;
    },
    cloneNode() {
      return createSvg();
    },
  });

  const logoHost = {
    dataset: { logoSrc: '/logo.svg' },
    replaceChildren(child) {
      this.child = child;
    },
  };

  const documentRef = {
    documentElement: {
      addEventListener(type, handler) {
        listeners.set(`document:${type}`, handler);
      },
      removeEventListener(type) {
        listeners.delete(`document:${type}`);
      },
    },
    querySelectorAll() {
      return [logoHost];
    },
  };

  const windowRef = {
    fetch: async () => ({
      ok: true,
      text: async () =>
        `<svg><title>SAUGOPS</title><path id="${LOGO_PART_SELECTORS[0].slice(1)}"/><path id="${LOGO_PART_SELECTORS[1].slice(1)}"/></svg>`,
    }),
    matchMedia: () => ({ matches: false }),
    addEventListener(type, handler) {
      listeners.set(`window:${type}`, handler);
    },
    removeEventListener(type) {
      listeners.delete(`window:${type}`);
    },
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
  };

  const DOMParserRef = class {
    parseFromString() {
      return {
        querySelector(selector) {
          return selector === 'parsererror' ? null : null;
        },
        documentElement: createSvg(),
      };
    }
  };

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousDOMParser = globalThis.DOMParser;

  globalThis.window = windowRef;
  globalThis.document = documentRef;
  globalThis.DOMParser = DOMParserRef;

  try {
    const cleanup = initLogoGaze(documentRef);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(logoHost.child, 'the SVG should be inlined into the logo host');
    assert.deepEqual(upperRibbon.transforms, ['translate(0.00 0.00)']);
    assert.deepEqual(lowerRibbon.transforms, ['translate(0.00 0.00)']);
    cleanup();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousDOMParser;
  }
});

test('logo gaze fails closed when the inline mark omits ribbon selectors', async () => {
  const logoHost = {
    dataset: { logoSrc: '/logo.svg' },
    replaceChildren(child) {
      this.child = child;
    },
  };

  const documentRef = {
    documentElement: {
      addEventListener() {},
      removeEventListener() {},
    },
    querySelectorAll() {
      return [logoHost];
    },
  };

  const windowRef = {
    fetch: async () => ({
      ok: true,
      text: async () => '<svg><title>SAUGOPS</title></svg>',
    }),
    matchMedia: () => ({ matches: false }),
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame() {
      return 1;
    },
    cancelAnimationFrame() {},
  };

  const DOMParserRef = class {
    parseFromString() {
      return {
        querySelector() {
          return null;
        },
        documentElement: {
          removeAttribute() {},
          setAttribute() {},
          querySelector(selector) {
            if (selector === 'title') return { remove() {} };
            return null;
          },
          cloneNode() {
            return this;
          },
        },
      };
    }
  };

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousDOMParser = globalThis.DOMParser;

  globalThis.window = windowRef;
  globalThis.document = documentRef;
  globalThis.DOMParser = DOMParserRef;

  try {
    const cleanup = initLogoGaze(documentRef);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.ok(
      logoHost.child,
      'the SVG should still inline when selectors are absent',
    );
    cleanup();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
    if (previousDOMParser === undefined) delete globalThis.DOMParser;
    else globalThis.DOMParser = previousDOMParser;
  }
});
