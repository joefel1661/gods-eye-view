import test from 'node:test';
import assert from 'node:assert/strict';
import { LayerPresentation } from './layerPresentation.js';

const CATEGORY_IDS = [
  'police',
  'fireEms',
  'hospitals',
  'urgentCare',
  'airports',
  'pharmacies',
];

function createManagerFixture({
  enabled = false,
  params = Object.fromEntries(CATEGORY_IDS.map((id) => [id, false])),
} = {}) {
  let layerEnabled = enabled;
  let layerParams = { ...params };
  const calls = [];
  const module = {
    categoryOrder: CATEGORY_IDS,
    getParams: () => ({ ...layerParams }),
    getPanelRows(layer) {
      return CATEGORY_IDS.map((categoryId) => ({
        id: `security-points-${categoryId.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`,
        panelCategoryId: categoryId,
        name: categoryId,
        icon: 'x',
        source: 'Google Maps Places',
        enabled: layer.enabled && layerParams[categoryId] === true,
        lifecycleState: layer.lifecycleState,
        lifecycleUncertain: layer.lifecycleUncertain,
        stats: { count: 0, source: 'Google Maps Places' },
      }));
    },
  };
  const manager = {
    layers: new Map([['security-points', { module }]]),
    subscribeActivity: () => () => {},
    getAll: () => [
      {
        id: 'security-points',
        name: 'Security Points',
        icon: '🛡',
        source: 'Google Maps Places',
        showInTogglePanel: true,
        enabled: layerEnabled,
        lifecycleState: layerEnabled ? 'enabled' : 'disabled',
        lifecycleUncertain: false,
        stats: {},
      },
    ],
    isEnabled: () => layerEnabled,
    async setEnabled(id, nextEnabled, options) {
      calls.push({ kind: 'enabled', id, nextEnabled, options });
      layerEnabled = nextEnabled;
      return true;
    },
    setLayerParams(id, nextParams, options) {
      calls.push({ kind: 'params', id, nextParams, options });
      layerParams = { ...nextParams };
      return true;
    },
  };
  return { manager, calls, getParams: () => ({ ...layerParams }), isEnabled: () => layerEnabled };
}

test('layer presentation expands Security Points into emergency point panel rows', () => {
  const { manager } = createManagerFixture();
  const presentation = new LayerPresentation(manager);
  const rows = presentation._panelRows();
  assert.deepEqual(
    rows.map((row) => row.id),
    [
      'security-points-police',
      'security-points-fire-ems',
      'security-points-hospitals',
      'security-points-urgent-care',
      'security-points-airports',
      'security-points-pharmacies',
    ],
  );
});

test('panel row toggle enables only the requested emergency category from an off state', async () => {
  const { manager, calls, getParams, isEnabled } = createManagerFixture();
  const presentation = new LayerPresentation(manager);
  const policeRow = presentation
    ._panelRows()
    .find((row) => row.panelCategoryId === 'police');
  await policeRow.panelToggle(true, { origin: 'user' });
  assert.equal(isEnabled(), true);
  assert.deepEqual(getParams(), {
    police: true,
    fireEms: false,
    hospitals: false,
    urgentCare: false,
    airports: false,
    pharmacies: false,
  });
  assert.deepEqual(
    calls.map(({ kind }) => kind),
    ['params', 'enabled'],
  );
});

test('panel row toggle disables the underlying layer after the last emergency category turns off', async () => {
  const { manager, getParams, isEnabled } = createManagerFixture({
    enabled: true,
    params: {
      police: true,
      fireEms: false,
      hospitals: false,
      urgentCare: false,
      airports: false,
      pharmacies: false,
    },
  });
  const presentation = new LayerPresentation(manager);
  const policeRow = presentation
    ._panelRows()
    .find((row) => row.panelCategoryId === 'police');
  await policeRow.panelToggle(false, { origin: 'user' });
  assert.equal(isEnabled(), false);
  assert.deepEqual(getParams(), {
    police: false,
    fireEms: false,
    hospitals: false,
    urgentCare: false,
    airports: false,
    pharmacies: false,
  });
});
