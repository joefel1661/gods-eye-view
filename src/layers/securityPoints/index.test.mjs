import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import {
  countLabelForState,
  SECURITY_POINT_MARKER_HEIGHT_M,
  securityPointMarkerGraphics,
  securityPointMarkerPosition,
  securityPointsStatusMessage,
  statusForFailedSecurityPointsLoad,
  statusForSuccessfulSecurityPointsLoad,
} from './index.js';

test('countLabelForState reports explicit loading and empty states', () => {
  assert.equal(
    countLabelForState({
      enabled: true,
      loading: true,
      status: 'loading',
      records: [],
    }),
    'Loading',
  );
  assert.equal(
    countLabelForState({
      enabled: true,
      loading: false,
      status: 'zoom-in',
      records: [],
    }),
    'Zoom in to view',
  );
  assert.equal(
    countLabelForState({
      enabled: true,
      loading: false,
      status: 'empty',
      records: [],
    }),
    'No facilities found',
  );
  assert.equal(
    countLabelForState({
      enabled: true,
      loading: false,
      status: 'unavailable',
      records: [],
    }),
    'Provider unavailable',
  );
  assert.equal(
    countLabelForState({
      enabled: true,
      loading: false,
      status: 'ready',
      records: [1, 2, 3],
    }),
    '3 nearby',
  );
});

test('statusForSuccessfulSecurityPointsLoad keeps successful Google results fresh even when optional fallback is unavailable', () => {
  assert.equal(
    statusForSuccessfulSecurityPointsLoad({
      records: [{ id: 'google:1' }],
      stale: false,
      failedCategories: [],
      primaryProvider: 'google',
    }),
    'ready',
  );
  assert.equal(
    securityPointsStatusMessage({ status: 'ready', saturated: false }),
    null,
  );
});

test('statusForSuccessfulSecurityPointsLoad reports partial Google category failures', () => {
  assert.equal(
    statusForSuccessfulSecurityPointsLoad({
      records: [{ id: 'google:1' }],
      stale: false,
      failedCategories: ['hospitals'],
      primaryProvider: 'google',
    }),
    'partial',
  );
  assert.match(
    securityPointsStatusMessage({ status: 'partial', saturated: false }),
    /partial security points coverage/i,
  );
});

test('statusForFailedSecurityPointsLoad keeps cached records stale when Google fails', () => {
  assert.equal(
    statusForFailedSecurityPointsLoad({ hasCachedRecords: true }),
    'stale',
  );
  assert.match(
    securityPointsStatusMessage({ status: 'stale', saturated: false }),
    /showing cached security points/i,
  );
});

test('statusForFailedSecurityPointsLoad reports load failed when Google fails without cache', () => {
  assert.equal(
    statusForFailedSecurityPointsLoad({ hasCachedRecords: false }),
    'unavailable',
  );
});

test('security point markers stay bound to geographic coordinates with ground-relative rendering', () => {
  const record = {
    category: 'police',
    latitude: 30.2672,
    longitude: -97.7431,
  };
  const expectedPosition = Cesium.Cartesian3.fromDegrees(
    record.longitude,
    record.latitude,
    SECURITY_POINT_MARKER_HEIGHT_M,
  );
  const position = securityPointMarkerPosition(record);
  assert.ok(
    Cesium.Cartesian3.equalsEpsilon(
      position,
      expectedPosition,
      Cesium.Math.EPSILON12,
    ),
  );

  const point = securityPointMarkerGraphics(record, { selected: false });
  assert.equal(
    point.heightReference,
    Cesium.HeightReference.RELATIVE_TO_GROUND,
  );
  assert.equal(point.disableDepthTestDistance, Number.POSITIVE_INFINITY);
  assert.equal(point.pixelSize, 9);
});
