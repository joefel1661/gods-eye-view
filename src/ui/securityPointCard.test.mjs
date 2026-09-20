import assert from 'node:assert/strict';
import test from 'node:test';
import { formatSecurityPointDistance } from './securityPointCard.js';

test('security point distances are presented in miles for my location readouts', () => {
  assert.equal(formatSecurityPointDistance(1287), '0.8 mi');
  assert.equal(formatSecurityPointDistance(0), '0.0 mi');
  assert.equal(formatSecurityPointDistance(24_140), '15 mi');
  assert.equal(formatSecurityPointDistance(Number.NaN), '');
});
