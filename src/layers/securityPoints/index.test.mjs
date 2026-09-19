import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countLabelForState,
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
