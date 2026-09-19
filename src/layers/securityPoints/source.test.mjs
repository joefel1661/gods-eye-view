import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityPointSource } from './source.js';

test('fetchViewport builds category-bounded Overpass queries and normalizes records', async () => {
  const calls = [];
  const source = createSecurityPointSource({
    fetchImpl: async (url, options) => {
      calls.push([url, options]);
      return new Response(
        JSON.stringify({
          elements: [
            {
              type: 'way',
              id: 7,
              center: { lat: 30.2672, lon: -97.7431 },
              geometry: [
                { lat: 30.2671, lon: -97.7432 },
                { lat: 30.2673, lon: -97.7432 },
                { lat: 30.2673, lon: -97.7430 },
              ],
              tags: {
                amenity: 'police',
                name: 'Austin Police HQ',
                'addr:housenumber': '715',
                'addr:street': 'E 8th St',
                'addr:city': 'Austin',
                phone: '+1 512-974-5000',
              },
            },
          ],
        }),
        {
          status: 200,
          headers: { 'x-overpass-cache': 'STALE' },
        },
      );
    },
  });

  const result = await source.fetchViewport(
    { south: 30.2, west: -97.8, north: 30.3, east: -97.7 },
    { police: true, fireEms: false, hospitals: false, airports: false },
  );

  assert.equal(String(calls[0][0]), '/api/overpass');
  const decodedBody = decodeURIComponent(String(calls[0][1].body));
  assert.match(decodedBody, /amenity"="police/);
  assert.doesNotMatch(decodedBody, /fire_station/);
  assert.equal(result.stale, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].category, 'police');
  assert.equal(result.records[0].address, '715 E 8th St · Austin');
  assert.equal(result.records[0].phone, '+1 512-974-5000');
  assert.equal(result.records[0].footprint.length, 3);
});

test('enrichRecord narrows nearby places by category and returns phone metadata', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      assert.equal(parsed.pathname, '/api/google/nearby-places');
      assert.equal(parsed.searchParams.get('includedTypes'), 'hospital');
      return Response.json({
        places: [
          {
            name: 'Clinic',
            address: 'Far away',
            phone: null,
            distanceM: 220,
            primaryType: 'clinic',
            types: ['clinic'],
          },
          {
            name: 'Saint David Hospital',
            address: '101 Main St',
            phone: '+1 512-555-0110',
            distanceM: 35,
            primaryType: 'hospital',
            types: ['hospital'],
            googleMapsUri: 'https://maps.google.test/place/1',
          },
        ],
      });
    },
  });

  const google = await source.enrichRecord({
    category: 'hospitals',
    name: 'Saint David Hospital',
    latitude: 30.2672,
    longitude: -97.7431,
  });

  assert.equal(google.address, '101 Main St');
  assert.equal(google.phone, '+1 512-555-0110');
  assert.equal(google.provider, 'Google Maps Places');
});
