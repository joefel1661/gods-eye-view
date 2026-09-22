import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Cesium from 'cesium';
import {
  buildMarkupCameraFlight,
  collectMarkupCameraPositions,
} from './markupPanel.js';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const markupPanelSource = readFileSync(
  path.join(ROOT, 'src', 'ui', 'markupPanel.js'),
  'utf8',
);

function marker(id, lon, lat, visible = true) {
  return {
    id,
    type: 'marker',
    visible,
    category: 'Other',
    title: '',
    description: '',
    notes: '',
    geometry: { position: { lon, lat, height: 0 } },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function circle(id, lon, lat, radiusMeters, visible = true) {
  return {
    id,
    type: 'circle',
    visible,
    category: 'Other',
    title: '',
    description: '',
    notes: '',
    geometry: {
      center: { lon, lat, height: 0 },
      radiusMeters,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

test('single visible marker gets a quick operational framing', () => {
  const markup = {
    id: 'alpha',
    name: 'Alpha',
    objects: [marker('m-1', -77.0365, 38.8977)],
  };
  const flight = buildMarkupCameraFlight(markup, {
    heading: 0,
    aspectRatio: 16 / 9,
    padding: {
      top: 24,
      right: 24,
      bottom: 24,
      left: 24,
      width: 1280,
      height: 720,
    },
  });
  assert.ok(flight);
  assert.equal(flight.mode, 'single-marker');
  assert.ok(flight.range >= 1200);
  const target = Cesium.Cartographic.fromCartesian(flight.target);
  assert.ok(target);
  assert.ok(Math.abs(Cesium.Math.toDegrees(target.longitude) + 77.0365) < 0.01);
  assert.ok(Math.abs(Cesium.Math.toDegrees(target.latitude) - 38.8977) < 0.01);
});

test('mixed visible geometry combines bounds and ignores hidden objects', () => {
  const markup = {
    id: 'bravo',
    name: 'Bravo',
    objects: [
      marker('m-1', -77.04, 38.89),
      marker('m-hidden', -76.7, 38.5, false),
      circle('c-1', -77.01, 38.91, 900),
    ],
  };
  const positions = collectMarkupCameraPositions(markup);
  assert.equal(positions.length, 10);
  const flight = buildMarkupCameraFlight(markup, {
    heading: Cesium.Math.toRadians(20),
    aspectRatio: 1.6,
    padding: {
      top: 40,
      right: 40,
      bottom: 40,
      left: 40,
      width: 1200,
      height: 800,
    },
  });
  assert.ok(flight);
  assert.equal(flight.mode, 'bounds');
  assert.ok(flight.sphere.radius > 800);
});

test('camera target shifts away from layer and header padding', () => {
  const markup = {
    id: 'charlie',
    name: 'Charlie',
    objects: [circle('c-1', -122.4194, 37.7749, 1200)],
  };
  const centered = buildMarkupCameraFlight(markup, {
    heading: 0,
    aspectRatio: 16 / 9,
    padding: {
      top: 24,
      right: 24,
      bottom: 24,
      left: 24,
      width: 1400,
      height: 900,
    },
  });
  const padded = buildMarkupCameraFlight(markup, {
    heading: 0,
    aspectRatio: 16 / 9,
    padding: {
      top: 180,
      right: 24,
      bottom: 24,
      left: 320,
      width: 1400,
      height: 900,
    },
  });
  assert.ok(centered && padded);
  const centeredCarto = Cesium.Cartographic.fromCartesian(centered.target);
  const paddedCarto = Cesium.Cartographic.fromCartesian(padded.target);
  assert.ok(padded.range > centered.range);
  assert.ok(
    Cesium.Math.toDegrees(paddedCarto.longitude) <
      Cesium.Math.toDegrees(centeredCarto.longitude),
  );
  assert.ok(
    Cesium.Math.toDegrees(paddedCarto.latitude) >
      Cesium.Math.toDegrees(centeredCarto.latitude),
  );
});

test('layers without visible valid geometry skip camera movement', () => {
  const markup = {
    id: 'delta',
    name: 'Delta',
    objects: [marker('m-hidden', -0.1278, 51.5074, false)],
  };
  assert.equal(buildMarkupCameraFlight(markup), null);
});

test('my layers camera movement only triggers on OFF to ON toggles', () => {
  assert.match(
    markupPanelSource,
    /const shouldFocus = markup\.visible === false && Boolean\(visible\);[\s\S]*?if \(shouldFocus\) focusMarkupLayer\(markup\);/s,
  );
});
