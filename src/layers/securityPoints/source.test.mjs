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
                { lat: 30.2673, lon: -97.743 },
              ],
              tags: {
                amenity: 'police',
                building: 'yes',
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
  assert.match(decodedBody, /name"~"sheriff"/);
  assert.doesNotMatch(decodedBody, /fire_station/);
  assert.match(decodedBody, /out tags center 250/);
  assert.doesNotMatch(decodedBody, /out tags center geom/);
  assert.equal(result.stale, true);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].category, 'police');
  assert.equal(result.records[0].address, '715 E 8th St · Austin');
  assert.equal(result.records[0].phone, '+1 512-974-5000');
  assert.equal(result.records[0].footprint.length, 3);
});

test('fetchViewport maps sheriff, EMS, emergency department, and airport records into the expected categories', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async () =>
      Response.json({
        elements: [
          {
            type: 'node',
            id: 1,
            lat: 30.1,
            lon: -97.1,
            tags: {
              office: 'government',
              name: 'Travis County Sheriff Office',
            },
          },
          {
            type: 'node',
            id: 2,
            lat: 30.2,
            lon: -97.2,
            tags: {
              amenity: 'ambulance_station',
              name: 'Austin EMS',
            },
          },
          {
            type: 'node',
            id: 3,
            lat: 30.3,
            lon: -97.3,
            tags: {
              emergency: 'emergency_department',
              name: 'Dell Seton ER',
            },
          },
          {
            type: 'node',
            id: 4,
            lat: 30.4,
            lon: -97.4,
            tags: {
              aeroway: 'airport',
              name: 'Example Airfield',
            },
          },
        ],
      }),
  });

  const result = await source.fetchViewport(
    { south: 30, west: -98, north: 31, east: -97 },
    { police: true, fireEms: true, hospitals: true, airports: true },
  );

  assert.deepEqual(
    result.records.map((record) => [record.category, record.typeLabel]),
    [
      ['police', 'Sheriff office'],
      ['fireEms', 'EMS station'],
      ['hospitals', 'Emergency department'],
      ['airports', 'Airport'],
    ],
  );
});

test('enrichRecord narrows nearby places by category and returns phone metadata', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      assert.equal(parsed.pathname, '/api/google/nearby-places');
      assert.equal(
        parsed.searchParams.get('includedTypes'),
        'hospital,emergency_room',
      );
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

test('fetchViewport returns partial category results when one category request fails', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async (_url, options) => {
      const body = decodeURIComponent(String(options?.body || ''));
      if (body.includes('amenity"="police"'))
        throw new DOMException('signal timed out', 'AbortError');
      return Response.json({
        elements: [
          {
            type: 'node',
            id: 77,
            lat: 30.25,
            lon: -97.75,
            tags: { amenity: 'fire_station', name: 'Austin Fire Station' },
          },
        ],
      });
    },
  });

  const result = await source.fetchViewport(
    { south: 30.2, west: -97.8, north: 30.3, east: -97.7 },
    { police: true, fireEms: true, hospitals: false, airports: false },
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].category, 'fireEms');
});
