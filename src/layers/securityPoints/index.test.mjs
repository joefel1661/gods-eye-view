import test from 'node:test';
import assert from 'node:assert/strict';
import { countLabelForState } from './index.js';

test('countLabelForState reports explicit loading and empty states', () => {
  assert.equal(
    countLabelForState({ enabled: true, loading: true, status: 'loading', records: [] }),
    'Loading',
  );
  assert.equal(
    countLabelForState({ enabled: true, loading: false, status: 'zoom-in', records: [] }),
    'Zoom in to view',
  );
  assert.equal(
    countLabelForState({ enabled: true, loading: false, status: 'empty', records: [] }),
    'No facilities found',
  );
  assert.equal(
    countLabelForState({ enabled: true, loading: false, status: 'unavailable', records: [] }),
    'Provider unavailable',
  );
  assert.equal(
    countLabelForState({ enabled: true, loading: false, status: 'ready', records: [1, 2, 3] }),
    '3 nearby',
  );
});
