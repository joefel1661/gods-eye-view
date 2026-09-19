import test from 'node:test';
import assert from 'node:assert/strict';
import { createSecurityPointSource } from './source.js';

function createGoogleViewportSource(placeByType = {}, fallbackResponse = null) {
  return createSecurityPointSource({
    fetchImpl: async (url, options) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/google/nearby-places') {
        const type = String(parsed.searchParams.get('includedTypes') || '').trim();
        return Response.json({ places: placeByType[type] || [] });
      }
      if (parsed.pathname === '/api/overpass') {
        if (typeof fallbackResponse === 'function')
          return fallbackResponse(parsed, options);
        if (fallbackResponse) return fallbackResponse;
      }
      throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
    },
  });
}

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

  const nearbyCalls = calls.filter(
    (call) => call.pathname === '/api/google/nearby-places',
  );
  assert.equal(nearbyCalls.length, 3);
  assert.deepEqual(
    nearbyCalls
      .map((call) => call.searchParams.get('includedTypes'))
      .sort(),
    ['ambulance_service', 'fire_station', 'police'],
  );
  assert.equal(
    calls.some((call) => call.pathname === '/api/overpass'),
    false,
    'overpass must not be required when google succeeds',
  );
  assert.equal(result.stale, false);
  assert.equal(result.primaryProvider, 'google');
  assert.deepEqual(result.failedCategories, []);
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

test('fetchViewport runs per-type Google searches for every enabled category mix', async () => {
  const requestedTypeSets = [];
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname !== '/api/google/nearby-places')
        throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
      const type = String(parsed.searchParams.get('includedTypes') || '').trim();
      requestedTypeSets.push(type);
      const placeByType = {
        police: {
          id: 'p-1',
          name: 'Police HQ',
          latitude: 30.1,
          longitude: -97.1,
          primaryType: 'police',
          types: ['police'],
        },
        fire_station: {
          id: 'f-1',
          name: 'Fire Station',
          latitude: 30.2,
          longitude: -97.2,
          primaryType: 'fire_station',
          types: ['fire_station'],
        },
        hospital: {
          id: 'h-1',
          name: 'Hospital',
          latitude: 30.3,
          longitude: -97.3,
          primaryType: 'hospital',
          types: ['hospital'],
        },
        airport: {
          id: 'a-1',
          name: 'Airport',
          latitude: 30.4,
          longitude: -97.4,
          primaryType: 'airport',
          types: ['airport'],
        },
      };
      return Response.json({ places: placeByType[type] ? [placeByType[type]] : [] });
    },
  });
  const box = { south: 30, west: -98, north: 31, east: -97 };
  const scenarios = [
    {
      name: 'police only',
      params: { police: true, fireEms: false, hospitals: false, airports: false },
      expectedTypes: ['police'],
      expectedCategories: ['police'],
    },
    {
      name: 'fire only',
      params: { police: false, fireEms: true, hospitals: false, airports: false },
      expectedTypes: ['ambulance_service', 'fire_station'],
      expectedCategories: ['fireEms'],
    },
    {
      name: 'hospital only',
      params: { police: false, fireEms: false, hospitals: true, airports: false },
      expectedTypes: ['emergency_room', 'hospital'],
      expectedCategories: ['hospitals'],
    },
    {
      name: 'airport only',
      params: { police: false, fireEms: false, hospitals: false, airports: true },
      expectedTypes: ['airport', 'heliport'],
      expectedCategories: ['airports'],
    },
    {
      name: 'police + fire + hospitals',
      params: { police: true, fireEms: true, hospitals: true, airports: false },
      expectedTypes: [
        'ambulance_service',
        'emergency_room',
        'fire_station',
        'hospital',
        'police',
      ],
      expectedCategories: ['police', 'fireEms', 'hospitals'],
    },
    {
      name: 'all categories',
      params: { police: true, fireEms: true, hospitals: true, airports: true },
      expectedTypes: [
        'airport',
        'ambulance_service',
        'emergency_room',
        'fire_station',
        'heliport',
        'hospital',
        'police',
      ],
      expectedCategories: ['police', 'fireEms', 'hospitals', 'airports'],
    },
  ];
  for (const scenario of scenarios) {
    requestedTypeSets.length = 0;
    const result = await source.fetchViewport(box, scenario.params);
    assert.deepEqual([...requestedTypeSets].sort(), [...scenario.expectedTypes].sort());
    assert.deepEqual(
      [...new Set(result.records.map((record) => record.category))].sort(),
      [...scenario.expectedCategories].sort(),
      scenario.name,
    );
  }
});

test('fetchViewport keeps successful categories when one category fails and reports progressive updates', async () => {
  const progress = [];
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.pathname === '/api/google/nearby-places') {
        const type = String(parsed.searchParams.get('includedTypes') || '');
        if (type === 'police')
          return Response.json({
            places: [
              {
                id: 'p-1',
                name: 'Police HQ',
                latitude: 30.1,
                longitude: -97.1,
                primaryType: 'government_office',
                types: ['government_office', 'point_of_interest'],
              },
            ],
          });
        if (type === 'fire_station')
          return Response.json({
            places: [
              {
                id: 'f-1',
                name: 'Fire Station',
                latitude: 30.2,
                longitude: -97.2,
                primaryType: 'fire_station',
                types: ['fire_station'],
              },
            ],
          });
        if (type === 'hospital')
          return Response.json(
            {
              error: 'downstream outage',
              providerError: { status: 'UNAVAILABLE', message: 'service unavailable' },
              places: [],
            },
            { status: 503 },
          );
        if (type === 'emergency_room')
          return Response.json(
            {
              error: 'downstream outage',
              providerError: { status: 'UNAVAILABLE', message: 'service unavailable' },
              places: [],
            },
            { status: 503 },
          );
        if (type === 'ambulance_service')
          return Response.json(
            {
              error: 'bad type',
              providerError: {
                status: 'INVALID_ARGUMENT',
                message: 'Unsupported includedTypes value: ambulance_service',
              },
              places: [],
            },
            { status: 400 },
          );
        return Response.json({ places: [] });
      }
      if (parsed.pathname === '/api/overpass')
        return Response.json({ error: 'fallback down' }, { status: 503 });
      throw new Error(`Unexpected endpoint: ${parsed.pathname}`);
    },
  });

  const result = await source.fetchViewport(
    { south: 30, west: -98, north: 31, east: -97 },
    { police: true, fireEms: true, hospitals: true, airports: false },
    {
      onCategoryProgress: (event) => {
        progress.push({
          provider: event.provider,
          category: event.category,
          status: event.status,
          recordCount: event.records.length,
        });
      },
    },
  );

  assert.equal(result.stale, false);
  assert.equal(result.primaryProvider, 'google');
  assert.deepEqual(result.failedCategories, ['hospitals']);
  assert.deepEqual(
    result.records.map((record) => [record.id, record.category]).sort(),
    [
      ['google:f-1', 'fireEms'],
      ['google:p-1', 'police'],
    ],
  );
  assert.ok(
    progress.some(
      (entry) =>
        entry.provider === 'google' &&
        entry.category === 'police' &&
        entry.status === 'fulfilled' &&
        entry.recordCount >= 1,
    ),
  );
  assert.ok(
    progress.some(
      (entry) =>
        entry.provider === 'google' &&
        entry.category === 'hospitals' &&
        entry.status === 'rejected',
    ),
  );
  assert.equal(
    result.records.find((record) => record.id === 'google:p-1')?.category,
    'police',
  );
});

test('fetchViewport accepts hospital-classified Google Places results', async () => {
  const source = createGoogleViewportSource({
    hospital: [
      {
        id: 'hospital-1',
        name: 'Seton Medical Center',
        latitude: 30.3,
        longitude: -97.3,
        primaryType: 'hospital',
        types: ['hospital', 'health'],
      },
    ],
    emergency_room: [],
  });

  const result = await source.fetchViewport(
    { south: 30, west: -98, north: 31, east: -97 },
    { police: false, fireEms: false, hospitals: true, airports: false },
  );

  assert.deepEqual(
    result.records.map((record) => [record.id, record.category, record.typeLabel]),
    [['google:hospital-1', 'hospitals', 'Hospital']],
  );
});

test('fetchViewport accepts emergency-room-classified Google Places results', async () => {
  const source = createGoogleViewportSource({
    hospital: [],
    emergency_room: [
      {
        id: 'er-1',
        name: 'Dell Seton ER',
        latitude: 30.3,
        longitude: -97.3,
        primaryType: 'emergency_room',
        types: ['emergency_room', 'hospital'],
      },
    ],
  });

  const result = await source.fetchViewport(
    { south: 30, west: -98, north: 31, east: -97 },
    { police: false, fireEms: false, hospitals: true, airports: false },
  );

  assert.deepEqual(
    result.records.map((record) => [record.id, record.category, record.typeLabel]),
    [['google:er-1', 'hospitals', 'Emergency department']],
  );
});

test('fetchViewport rejects individual doctors from hospital discovery', async () => {
  const source = createGoogleViewportSource({
    hospital: [
      {
        id: 'doctor-1',
        name: 'Pratima V. Kumar, MD',
        latitude: 30.3,
        longitude: -97.3,
        primaryType: 'doctor',
        types: ['doctor', 'health', 'point_of_interest'],
      },
    ],
    emergency_room: [],
  });

  const result = await source.fetchViewport(
    { south: 30, west: -98, north: 31, east: -97 },
    { police: false, fireEms: false, hospitals: true, airports: false },
  );

  assert.equal(result.records.length, 0);
});

test('fetchViewport rejects clinics and medical offices unless Google classifies them as hospital care', async () => {
  const source = createGoogleViewportSource({
    hospital: [
      {
        id: 'clinic-1',
        name: 'Neighborhood Medical Clinic',
        latitude: 30.31,
        longitude: -97.31,
        primaryType: 'medical_office',
        types: ['medical_office', 'health'],
      },
      {
        id: 'clinic-2',
        name: 'Regional Emergency Clinic',
        latitude: 30.32,
        longitude: -97.32,
        primaryType: 'medical_office',
        types: ['hospital', 'medical_office', 'health'],
      },
    ],
    emergency_room: [],
  });

  const result = await source.fetchViewport(
    { south: 30, west: -98, north: 31, east: -97 },
    { police: false, fireEms: false, hospitals: true, airports: false },
  );

  assert.deepEqual(
    result.records.map((record) => record.id),
    ['google:clinic-2'],
  );
});

test('fetchViewport keeps sibling searches alive when one type in the category fails', async () => {
  const requestedTypes = [];
  const source = createSecurityPointSource({
    fetchImpl: async (url) => {
      const parsed = new URL(String(url), 'http://localhost');
      const type = String(parsed.searchParams.get('includedTypes') || '');
      requestedTypes.push(type);
      if (type === 'fire_station') {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return Response.json({
          places: [
            {
              id: 'fire-1',
              name: 'Station 1',
              latitude: 30.1,
              longitude: -97.1,
              primaryType: 'fire_station',
              types: ['fire_station'],
            },
          ],
        });
      }
      if (type === 'ambulance_service')
        return Response.json(
          {
            error: 'bad type',
            providerError: {
              status: 'INVALID_ARGUMENT',
              message: 'Unsupported includedTypes value: ambulance_service',
            },
            places: [],
          },
          { status: 400 },
        );
      return Response.json({ places: [] });
    },
  });

  const result = await source.fetchViewport(
    { south: 30, west: -98, north: 31, east: -97 },
    { police: false, fireEms: true, hospitals: false, airports: false },
  );

  assert.deepEqual([...requestedTypes].sort(), ['ambulance_service', 'fire_station']);
  assert.deepEqual(
    result.records.map((record) => [record.id, record.category]),
    [['google:fire-1', 'fireEms']],
  );
});

test('aborting an older viewport generation does not cancel newer generation category searches', async () => {
  const calls = [];
  function delayedResponse(signal, ms, payload) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(Response.json(payload)), ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          const aborted = new Error('aborted');
          aborted.name = 'AbortError';
          reject(aborted);
        },
        { once: true },
      );
    });
  }
  const source = createSecurityPointSource({
    fetchImpl: async (url, options) => {
      const parsed = new URL(String(url), 'http://localhost');
      const type = String(parsed.searchParams.get('includedTypes') || '');
      const lat = Number(parsed.searchParams.get('lat'));
      calls.push({ lat, type });
      if (lat > 31)
        return delayedResponse(options?.signal, 60, {
          places: [
            {
              id: `old-${type || 'none'}`,
              name: 'Old Gen',
              latitude: lat,
              longitude: -97,
              primaryType: type || 'police',
              types: type ? [type] : [],
            },
          ],
        });
      return delayedResponse(options?.signal, 10, {
        places: [
          {
            id: `new-${type || 'none'}`,
            name: 'New Gen',
            latitude: lat,
            longitude: -97,
            primaryType: type || 'police',
            types: type ? [type] : [],
          },
        ],
      });
    },
  });

  const oldController = new AbortController();
  const oldFetch = source
    .fetchViewport(
      { south: 31.8, west: -98, north: 32.2, east: -97 },
      { police: true, fireEms: true, hospitals: false, airports: false },
      { signal: oldController.signal },
    )
    .then(() => null, (error) => error);

  const newFetch = source.fetchViewport(
    { south: 30, west: -98, north: 30.4, east: -97.6 },
    { police: true, fireEms: true, hospitals: false, airports: false },
  );

  oldController.abort();
  const [oldResult, newResult] = await Promise.all([oldFetch, newFetch]);

  assert.ok(oldResult instanceof Error);
  assert.ok(newResult.records.length >= 1);
  assert.ok(
    calls.some((entry) => entry.lat < 31 && entry.type === 'police'),
    'new generation police search should still run',
  );
  assert.ok(
    calls.some((entry) => entry.lat < 31 && entry.type === 'fire_station'),
    'new generation fire search should still run',
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

test('enrichRecord returns null when no googlePlaceId is available', async () => {
  const source = createSecurityPointSource({
    fetchImpl: async () => {
      throw new Error('should not fetch');
    },
  });
  const google = await source.enrichRecord({
    category: 'police',
    id: 'osm:node:1',
  });
  assert.equal(google, null);
});
