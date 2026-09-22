import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LayerPanel, LAYER_PANEL_SECTIONS } from './layerPanel.js';

const previousDocument = globalThis.document;
const previousWindow = globalThis.window;

afterEach(() => {
  globalThis.document = previousDocument;
  globalThis.window = previousWindow;
});

function selectorToDatasetKey(attribute) {
  return attribute
    .replace(/^data-/, '')
    .replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function createFixture({
  layers = [],
  markups = [],
  onToggle = async () => {},
  onMarkupToggle = async () => {},
} = {}) {
  class Node {
    constructor(tagName, ownerDocument) {
      this.tagName = tagName.toUpperCase();
      this.ownerDocument = ownerDocument;
      this.children = [];
      this.parentNode = null;
      this.dataset = {};
      this.attributes = new Map();
      this.className = '';
      this.id = '';
      this.hidden = false;
      this.disabled = false;
      this.type = '';
      this.title = '';
      this.style = {};
      this._text = '';
      this._listeners = new Map();
      this.classList = {
        add: (...names) => {
          const next = new Set(this.className.split(/\s+/).filter(Boolean));
          for (const name of names) next.add(name);
          this.className = [...next].join(' ');
        },
        remove: (...names) => {
          const next = new Set(this.className.split(/\s+/).filter(Boolean));
          for (const name of names) next.delete(name);
          this.className = [...next].join(' ');
        },
        contains: (name) => this.className.split(/\s+/).includes(name),
        toggle: (name, force) => {
          const active = this.className.split(/\s+/).includes(name);
          const next = force ?? !active;
          if (next) this.classList.add(name);
          else this.classList.remove(name);
          return next;
        },
      };
    }
    appendChild(node) {
      return this.insertBefore(node, null);
    }
    append(...nodes) {
      for (const node of nodes) this.insertBefore(node, null);
    }
    insertBefore(node, anchor) {
      if (node.parentNode) node.remove();
      const index =
        anchor == null ? this.children.length : this.children.indexOf(anchor);
      this.children.splice(index, 0, node);
      node.parentNode = this;
      return node;
    }
    removeChild(node) {
      const index = this.children.indexOf(node);
      if (index >= 0) {
        this.children.splice(index, 1);
        node.parentNode = null;
      }
      return node;
    }
    remove() {
      this.parentNode?.removeChild(this);
    }
    replaceChildren(...nodes) {
      for (const child of [...this.children]) child.remove();
      this._text = '';
      this.append(...nodes);
    }
    addEventListener(type, listener) {
      if (!this._listeners.has(type)) this._listeners.set(type, new Set());
      this._listeners.get(type).add(listener);
    }
    removeEventListener(type, listener) {
      this._listeners.get(type)?.delete(listener);
    }
    async dispatchEvent(event) {
      event.target ??= this;
      event.currentTarget = this;
      const listeners = [...(this._listeners.get(event.type) || [])];
      for (const listener of listeners) await listener(event);
      return !event.defaultPrevented;
    }
    click() {
      return this.dispatchEvent({
        type: 'click',
        target: this,
        currentTarget: this,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      });
    }
    scrollIntoView() {}
    setAttribute(name, value) {
      const stringValue = String(value);
      this.attributes.set(name, stringValue);
      if (name === 'id') this.id = stringValue;
      if (name === 'class') this.className = stringValue;
      if (name.startsWith('data-')) {
        this.dataset[selectorToDatasetKey(name)] = stringValue;
      }
    }
    getAttribute(name) {
      if (name === 'id') return this.id || null;
      if (name === 'class') return this.className || null;
      if (name.startsWith('data-')) {
        const key = selectorToDatasetKey(name);
        return this.dataset[key] ?? this.attributes.get(name) ?? null;
      }
      return this.attributes.get(name) ?? null;
    }
    get textContent() {
      return `${this._text}${this.children.map((child) => child.textContent).join('')}`;
    }
    set textContent(value) {
      this.replaceChildren();
      this._text = String(value);
    }
    set innerHTML(value) {
      if (value === '') this.replaceChildren();
    }
    get firstChild() {
      return this.children[0] || null;
    }
    contains(node) {
      return (
        this === node || this.children.some((child) => child.contains(node))
      );
    }
    matches(selector) {
      const classMatches = [...selector.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map(
        (match) => match[1],
      );
      const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
      const attrMatches = [
        ...selector.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g),
      ];
      const tagMatch = selector.match(/^[a-zA-Z][a-zA-Z0-9-]*/);
      if (tagMatch && this.tagName !== tagMatch[0].toUpperCase()) return false;
      if (idMatch && this.id !== idMatch[1]) return false;
      for (const className of classMatches) {
        if (!this.classList.contains(className)) return false;
      }
      for (const [, attr, expected] of attrMatches) {
        let actual = null;
        if (attr === 'id') actual = this.id;
        else if (attr === 'class') actual = this.className;
        else if (attr.startsWith('data-'))
          actual = this.dataset[selectorToDatasetKey(attr)] ?? null;
        else actual = this.attributes.get(attr) ?? null;
        if (expected == null) {
          if (actual == null) return false;
        } else if (String(actual) !== expected) {
          return false;
        }
      }
      return true;
    }
    closest(selector) {
      for (let node = this; node; node = node.parentNode) {
        if (node.matches(selector)) return node;
      }
      return null;
    }
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }
    querySelectorAll(selector) {
      const matches = [];
      for (const child of this.children) {
        if (child.matches(selector)) matches.push(child);
        matches.push(...child.querySelectorAll(selector));
      }
      return matches;
    }
  }

  const document = {
    body: null,
    createElement(tagName) {
      return new Node(tagName, document);
    },
  };
  document.body = new Node('body', document);
  globalThis.document = document;
  globalThis.window = {
    __gevMarkupsLayerApi: {
      list: () => markups.map((markup) => ({ ...markup })),
      setVisible: onMarkupToggle,
    },
  };

  let currentLayers = layers.map((layer) => ({
    ...layer,
    stats: { source: 'Test', ...(layer.stats || {}) },
  }));
  const panel = new LayerPanel({
    getLayers: () => currentLayers,
    isEnabled: (id) => currentLayers.find((layer) => layer.id === id)?.enabled,
    setEnabled: async (id, enabled, options) => {
      currentLayers = currentLayers.map((layer) =>
        layer.id === id ? { ...layer, enabled } : layer,
      );
      return onToggle(id, enabled, options);
    },
    setLayerParams: () => {},
    getRowControls: (id) =>
      id === 'security-points'
        ? {
            chips: [
              { id: 'police', label: 'POLICE', active: true, params: {} },
            ],
            legend: [{ label: 'Police', color: '#3b82f6', count: 2 }],
          }
        : null,
    hasRowControls: (id) => id === 'security-points',
    subscribeRowControls: () => () => {},
  });
  const container = document.createElement('div');
  document.body.appendChild(container);
  return { panel, container };
}

test('section configuration matches the requested grouping and defaults', () => {
  assert.deepEqual(
    LAYER_PANEL_SECTIONS.map(({ id, label, defaultExpanded, ids }) => ({
      id,
      label,
      defaultExpanded,
      ids,
    })),
    [
      { id: 'my-layers', label: 'MY LAYERS', defaultExpanded: true, ids: [] },
      {
        id: 'security-emergency',
        label: 'SECURITY & EMERGENCY',
        defaultExpanded: true,
        ids: ['security-points'],
      },
      {
        id: 'movement-transit',
        label: 'MOVEMENT & TRANSIT',
        defaultExpanded: false,
        ids: [
          'flights',
          'military',
          'ais-live-vessels',
          'traffic',
          'transit',
          'directions',
        ],
      },
      {
        id: 'cameras-monitoring',
        label: 'CAMERAS & MONITORING',
        defaultExpanded: false,
        ids: ['cctv', 'alpr-cameras'],
      },
      {
        id: 'hazards-events',
        label: 'HAZARDS & EVENTS',
        defaultExpanded: false,
        ids: ['local-firms', 'earthquakes'],
      },
      {
        id: 'infrastructure',
        label: 'INFRASTRUCTURE',
        defaultExpanded: false,
        ids: ['military-installations', 'local-datacenters', 'local-dams'],
      },
      {
        id: 'communications',
        label: 'COMMUNICATIONS',
        defaultExpanded: false,
        ids: ['radio'],
      },
    ],
  );
});

test('renders My Layers first with an empty state and the requested default disclosure states', () => {
  const { panel, container } = createFixture({
    layers: [
      {
        id: 'flights',
        name: 'Live Flights',
        icon: '✈',
        enabled: false,
        showInTogglePanel: true,
        stats: { count: 12 },
      },
      {
        id: 'security-points',
        name: 'Security Points',
        icon: '🛡',
        enabled: true,
        showInTogglePanel: true,
        stats: { count: 4 },
      },
      {
        id: 'radio',
        name: 'Radio',
        icon: '📻',
        enabled: false,
        showInTogglePanel: true,
        stats: { count: 1 },
      },
    ],
  });
  panel.mount(container);

  const sections = container.querySelectorAll('.data-layer-section');
  assert.deepEqual(
    sections.map((section) => section.dataset.layerSection),
    ['my-layers', 'security-emergency', 'movement-transit', 'communications'],
  );

  const myLayers = container.querySelector('[data-layer-section="my-layers"]');
  assert.equal(
    myLayers.querySelector('.data-layer-empty-state')?.textContent,
    'No custom layers yet.',
  );
  assert.equal(
    myLayers
      .querySelector('.data-layer-section-toggle')
      ?.getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(
    container
      .querySelector('[data-layer-section="security-emergency"]')
      ?.querySelector('.data-layer-section-toggle')
      ?.getAttribute('aria-expanded'),
    'true',
  );
  assert.equal(
    container
      .querySelector('[data-layer-section="movement-transit"]')
      ?.querySelector('.data-layer-section-toggle')
      ?.getAttribute('aria-expanded'),
    'false',
  );
});

test('renders saved markups in My Layers and preserves layer and markup toggles', async () => {
  const layerToggles = [];
  const markupToggles = [];
  const { panel, container } = createFixture({
    layers: [
      {
        id: 'security-points',
        name: 'Security Points',
        icon: '🛡',
        enabled: true,
        showInTogglePanel: true,
        stats: { count: 4 },
      },
      {
        id: 'flights',
        name: 'Live Flights',
        icon: '✈',
        enabled: false,
        showInTogglePanel: true,
        stats: { count: 12 },
      },
    ],
    markups: [{ id: 'alpha', name: 'Alpha Overlay', visible: true }],
    onToggle: async (...args) => layerToggles.push(args),
    onMarkupToggle: async (...args) => markupToggles.push(args),
  });
  panel.mount(container);

  const markupSection = container.querySelector(
    '[data-layer-section="my-layers"]',
  );
  const markupRow = markupSection.querySelector('.data-toggle-row-markup');
  assert.match(markupRow.textContent, /Alpha Overlay/);

  const [markupButton] = markupRow.querySelectorAll('.data-toggle-btn');
  await markupButton.click();
  assert.deepEqual(markupToggles, [['alpha', false]]);

  const flightsRow = container.querySelector('[data-layer-id="flights"]');
  assert.ok(flightsRow, 'existing layers should still be rendered');
  const flightsButton = flightsRow.querySelector('.data-toggle-btn');
  await flightsButton.click();
  assert.deepEqual(layerToggles, [['flights', true, { origin: 'user' }]]);

  const securityRow = container.querySelector(
    '[data-layer-id="security-points"]',
  );
  assert.equal(securityRow.querySelectorAll('.data-toggle-chip').length, 1);
});
