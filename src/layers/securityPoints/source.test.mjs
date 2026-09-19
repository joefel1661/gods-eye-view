import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityPointSource } from './source.js';

test('fetchViewport uses Google Places as the primary category discovery source', async () => {
  const calls = [];
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      calls.push(parsed);
      if (parsed.pathname === '/api/google/nearby-places') {
        const includedTypes = String(parsed.searchParams.get('includedTypes') || '');
        if (includedTypes.includes('police'))
          return Response.json({
            places: [
              {
                id: 'police-1',
                name: 'Austin Police HQ',
                address: '715 E 8th St',
                latitude: 30.2672,
                longitude: -97.7431,
                primaryType: 'police',
                types: ['police'],
              },
            ],
          });
        if (includedTypes.includes('fire_station'))
          return Response.json({
            places: [
              {
                id: 'fire-1',
                name: 'Austin Fire Station 1',
                address: '401 E 5th St',
                latitude: 30.2668,
                longitude: -97.7412,
                primaryType: 'fire_station',
                types: ['fire_station'],
              },
            ],
          });
        return Response.json({ places: [] });
      }
      throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
    },
  });

  const result = await source.fetchViewport(
    { south: 30.2, west: -97.8, north: 30.3, east: -97.7 },
    { police: true, fireEms: true, hospitals: false, airports: false },
  );

  assert.equal(
    calls.filter((call) => call.pathname === '/api/google/nearby-places').length,
    2,
  );
  assert.equal(
    calls.some((call) => call.pathname === '/api/overpass'),
    false,
    'overpass must not be required when google succeeds',
  );
  assert.equal(result.stale, false);
  assert.equal(result.records.length, 2);
  assert.deepEqual(
    result.records.map((record) => [record.id, record.category, record.provider]),
    [
      ['google:police-1', 'police', 'Google Maps Places'],
      ['google:fire-1', 'fireEms', 'Google Maps Places'],
    ],
  );
});

test('fetchViewport falls back to Overpass when Google Places is unavailable', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async (url, options) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/google/nearby-places')
        return Response.json(
          { error: 'Denied', providerError: { message: 'Denied' }, places: [] },
          { status: 403 },
        );
      if (parsed.pathname === '/api/overpass') {
        const decodedBody = new URLSearchParams(String(options?.body || '')).get(
          'data',
        );
        assert.match(decodedBody, /amenity"="police/);
        return Response.json({
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
              },
            },
          ],
        });
      }
      throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
    },
  });

  const result = await source.fetchViewport(
    { south: 30.2, west: -97.8, north: 30.3, east: -97.7 },
    { police: true, fireEms: false, hospitals: false, airports: false },
  );
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, 'osm:way:7');
  assert.equal(result.records[0].category, 'police');
  assert.equal(result.records[0].provider, 'OpenStreetMap');
  assert.equal(Array.isArray(result.records[0].footprint), true);
});

test('fetchViewport maps sheriff, EMS, emergency department, airport, and heliport records into expected labels', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname !== '/api/google/nearby-places')
        throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
      const includedTypes = String(parsed.searchParams.get('includedTypes') || '');
      if (includedTypes.includes('police'))
        return Response.json({
          places: [
            {
              id: 'sheriff-1',
              name: 'Travis County Sheriff Office',
              latitude: 30.1,
              longitude: -97.1,
              primaryType: 'police',
              types: ['police'],
            },
          ],
        });
      if (includedTypes.includes('fire_station'))
        return Response.json({
          places: [
            {
              id: 'ems-1',
              name: 'Austin EMS',
              latitude: 30.2,
              longitude: -97.2,
              primaryType: 'ambulance_service',
              types: ['ambulance_service'],
            },
          ],
        });
      if (includedTypes.includes('hospital'))
        return Response.json({
          places: [
            {
              id: 'er-1',
              name: 'Dell Seton ER',
              latitude: 30.3,
              longitude: -97.3,
              primaryType: 'emergency_room',
              types: ['emergency_room'],
            },
          ],
        });
      if (includedTypes.includes('airport'))
        return Response.json({
          places: [
            {
              id: 'helipad-1',
              name: 'City Heliport',
              latitude: 30.4,
              longitude: -97.4,
              primaryType: 'heliport',
              types: ['heliport'],
            },
          ],
        });
      return Response.json({ places: [] });
    },
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
      ['airports', 'Heliport'],
    ],
  );
});

test('enrichRecord uses Google place-details by place id for phone metadata', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      assert.equal(parsed.pathname, '/api/google/place-details');
      assert.equal(parsed.searchParams.get('placeId'), 'abc123');
      return Response.json({
        place: {
          id: 'abc123',
          name: 'Saint David Hospital',
          address: '101 Main St',
          phone: '+1 512-555-0110',
          primaryType: 'hospital',
          googleMapsUri: 'https://maps.google.test/place/1',
        },
      });
    },
  });

  const google = await source.enrichRecord({
    category: 'hospitals',
    googlePlaceId: 'abc123',
  });

  assert.equal(google.address, '101 Main St');
  assert.equal(google.phone, '+1 512-555-0110');
  assert.equal(google.provider, 'Google Maps Places');
});
