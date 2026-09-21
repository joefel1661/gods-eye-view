import assert from 'node:assert/strict';
import test from 'node:test';
import * as Cesium from 'cesium';
import { createAnnotationResolver } from './resolver.js';

function createFeatureSource() {
  const noop = async () => [];
  return {
    getAdministrativeAreas: noop,
    getAreaGeometry: noop,
    getNeighborhoodAreas: noop,
    getStreetAreas: noop,
    getStreetLines: noop,
    getFootprints: noop,
    getEnclosingAreas: noop,
    getMonuments: noop,
    getFocusFootprints: noop,
  };
}

function createViewer({
  pickPositionSupported = false,
  pickPosition = null,
  globePick = null,
  pickEllipsoid = null,
} = {}) {
  const calls = { pickPosition: 0, globePick: 0, pickEllipsoid: 0, getPickRay: 0 };
  const viewer = {
    scene: {
      canvas: { clientWidth: 1200, clientHeight: 800 },
      pickPositionSupported,
      pickPosition(position) {
        calls.pickPosition += 1;
        return pickPosition ? pickPosition(position) : null;
      },
      globe: {
        pick(ray, scene) {
          calls.globePick += 1;
          return globePick ? globePick(ray, scene) : null;
        },
      },
    },
    camera: {
      getPickRay(position) {
        calls.getPickRay += 1;
        return { position };
      },
      pickEllipsoid(position) {
        calls.pickEllipsoid += 1;
        return pickEllipsoid ? pickEllipsoid(position) : null;
      },
    },
  };
  return { viewer, calls };
}

test('pickWorldFromScreen prefers rendered surface picks before ellipsoid fallback', () => {
  const resolver = createAnnotationResolver({ featureSource: createFeatureSource() });
  const terrainPoint = Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 250);
  const ellipsoidPoint = Cesium.Cartesian3.fromDegrees(-97.7431, 30.2672, 0);
  const { viewer, calls } = createViewer({
    pickPositionSupported: true,
    pickPosition: () => null,
    globePick: () => terrainPoint,
    pickEllipsoid: () => ellipsoidPoint,
  });

  const picked = resolver.pickWorldFromScreen(viewer, 0.5, 0.5);

  assert.equal(calls.pickPosition, 1);
  assert.equal(calls.globePick, 1);
  assert.equal(calls.pickEllipsoid, 0);
  assert.ok(picked);
  assert.ok(Math.abs(picked.lon + 97.7431) < 1e-6);
  assert.ok(Math.abs(picked.lat - 30.2672) < 1e-6);
  assert.ok(Math.abs(picked.height - 250) < 1e-3);
});

test('pickWorldFromScreen still falls back to the ellipsoid when no rendered surface is available', () => {
  const resolver = createAnnotationResolver({ featureSource: createFeatureSource() });
  const ellipsoidPoint = Cesium.Cartesian3.fromDegrees(12.4924, 41.8902, 0);
  const { viewer, calls } = createViewer({
    pickPositionSupported: false,
    globePick: () => null,
    pickEllipsoid: () => ellipsoidPoint,
  });

  const picked = resolver.pickWorldFromScreen(viewer, 0.5, 0.5);

  assert.equal(calls.pickPosition, 0);
  assert.equal(calls.globePick, 1);
  assert.equal(calls.pickEllipsoid, 1);
  assert.ok(picked);
  assert.ok(Math.abs(picked.lon - 12.4924) < 1e-6);
  assert.ok(Math.abs(picked.lat - 41.8902) < 1e-6);
  assert.equal(picked.height, 0);
});
