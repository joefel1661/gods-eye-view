import {
  CATEGORY_CONFIG,
  CATEGORY_ORDER,
  GOOGLE_NEARBY_URL,
  MAX_VIEWPORT_DEGREES,
  OVERPASS_URL,
  QUERY_LIMIT,
} from './policy.js';

function validateBox(box) {
  const { south, west, north, east } = box || {};
  if (
    ![south, west, north, east].every(Number.isFinite) ||
    south < -90 ||
    north > 90 ||
    west < -180 ||
    east > 180 ||
    north <= south ||
    east <= west ||
    north - south > MAX_VIEWPORT_DEGREES ||
    east - west > MAX_VIEWPORT_DEGREES
  )
    throw new TypeError('A bounded Security Points viewport is required');
}

function sanitizeEnabledCategories(categories = {}) {
  return CATEGORY_ORDER.filter((id) => categories[id] !== false);
}

function formatViewportValue(value) {
  return Number(value).toFixed(5);
}

function buildOverpassQuery(box, enabledCategories) {
  const bbox = `(${formatViewportValue(box.south)},${formatViewportValue(box.west)},${formatViewportValue(box.north)},${formatViewportValue(box.east)})`;
  const clauses = [];
  if (enabledCategories.includes('police')) {
    clauses.push(`node["amenity"="police"]${bbox};`);
    clauses.push(`way["amenity"="police"]${bbox};`);
    clauses.push(`relation["amenity"="police"]${bbox};`);
  }
  if (enabledCategories.includes('fireEms')) {
    clauses.push(`node["amenity"="fire_station"]${bbox};`);
    clauses.push(`way["amenity"="fire_station"]${bbox};`);
    clauses.push(`relation["amenity"="fire_station"]${bbox};`);
    clauses.push(`node["emergency"="ambulance_station"]${bbox};`);
    clauses.push(`way["emergency"="ambulance_station"]${bbox};`);
    clauses.push(`relation["emergency"="ambulance_station"]${bbox};`);
  }
  if (enabledCategories.includes('hospitals')) {
    clauses.push(`node["amenity"="hospital"]${bbox};`);
    clauses.push(`way["amenity"="hospital"]${bbox};`);
    clauses.push(`relation["amenity"="hospital"]${bbox};`);
    clauses.push(`node["healthcare"="hospital"]${bbox};`);
    clauses.push(`way["healthcare"="hospital"]${bbox};`);
    clauses.push(`relation["healthcare"="hospital"]${bbox};`);
    clauses.push(`node["emergency"="emergency_ward"]${bbox};`);
    clauses.push(`way["emergency"="emergency_ward"]${bbox};`);
    clauses.push(`relation["emergency"="emergency_ward"]${bbox};`);
    clauses.push(`node["emergency"="emergency_department"]${bbox};`);
    clauses.push(`way["emergency"="emergency_department"]${bbox};`);
    clauses.push(`relation["emergency"="emergency_department"]${bbox};`);
  }
  if (enabledCategories.includes('airports')) {
    clauses.push(`node["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`way["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`relation["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`node["aeroway"="heliport"]${bbox};`);
    clauses.push(`way["aeroway"="heliport"]${bbox};`);
    clauses.push(`relation["aeroway"="heliport"]${bbox};`);
  }
  return `[out:json][timeout:25];(\n${clauses.join('\n')}\n);out tags center geom ${QUERY_LIMIT};`;
}

function formatAddress(tags = {}) {
  const street = [tags['addr:housenumber'], tags['addr:street']]
    .filter(Boolean)
    .join(' ')
    .trim();
  const locality = [tags['addr:city'], tags['addr:state'], tags['addr:postcode']]
    .filter(Boolean)
    .join(', ')
    .trim();
  return [street, locality].filter(Boolean).join(' · ') || null;
}

function normalizePhone(tags = {}) {
  const raw = tags['contact:phone'] || tags.phone || null;
  const value = String(raw || '').trim();
  return value || null;
}

function inferCategory(tags = {}) {
  const aeroway = String(tags.aeroway || '').toLowerCase();
  if (aeroway === 'aerodrome' || aeroway === 'heliport') return 'airports';
  const emergency = String(tags.emergency || '').toLowerCase();
  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();
  if (
    amenity === 'hospital' ||
    healthcare === 'hospital' ||
    emergency === 'emergency_ward' ||
    emergency === 'emergency_department'
  )
    return 'hospitals';
  if (amenity === 'fire_station' || emergency === 'ambulance_station')
    return 'fireEms';
  if (amenity === 'police') return 'police';
  return null;
}

function typeLabelForCategory(category, tags = {}) {
  if (category === 'airports')
    return String(tags.aeroway || '').toLowerCase() === 'heliport'
      ? 'Heliport'
      : 'Airport';
  if (category === 'hospitals') {
    const emergency = String(tags.emergency || '').toLowerCase();
    if (emergency === 'emergency_ward' || emergency === 'emergency_department')
      return 'Emergency department';
    return 'Hospital';
  }
  if (category === 'fireEms') {
    if (String(tags.emergency || '').toLowerCase() === 'ambulance_station')
      return 'EMS station';
    return 'Fire station';
  }
  if (category === 'police') return 'Police facility';
  return 'Security point';
}

function normalizeFootprint(element) {
  const geometry = Array.isArray(element?.geometry) ? element.geometry : null;
  if (!geometry || geometry.length < 3) return null;
  const ring = geometry
    .filter((point) => Number.isFinite(point?.lon) && Number.isFinite(point?.lat))
    .map((point) => [point.lon, point.lat]);
  return ring.length >= 3 ? ring : null;
}

function normalizeRecord(element) {
  const tags = element?.tags || {};
  const category = inferCategory(tags);
  if (!category) return null;
  const latitude = Number.isFinite(element?.lat)
    ? element.lat
    : Number.isFinite(element?.center?.lat)
      ? element.center.lat
      : null;
  const longitude = Number.isFinite(element?.lon)
    ? element.lon
    : Number.isFinite(element?.center?.lon)
      ? element.center.lon
      : null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const footprint = normalizeFootprint(element);
  return {
    id: `osm:${element.type}:${element.id}`,
    osmType: element.type,
    osmId: element.id,
    category,
    name:
      String(tags.name || '').trim() ||
      CATEGORY_CONFIG[category]?.cardLabel ||
      'Security Point',
    typeLabel: typeLabelForCategory(category, tags),
    latitude,
    longitude,
    footprint,
    address: formatAddress(tags),
    phone: normalizePhone(tags),
    tags,
    provider: 'OpenStreetMap',
    providerHref: 'https://www.openstreetmap.org/copyright',
    google: null,
  };
}

function queryKey(box, enabledCategories) {
  return `${enabledCategories.join(',')}|${formatViewportValue(box.south)}|${formatViewportValue(box.west)}|${formatViewportValue(box.north)}|${formatViewportValue(box.east)}`;
}

function boundedPush(map, key, value, maxEntries = 24) {
  map.set(key, value);
  while (map.size > maxEntries) map.delete(map.keys().next().value);
}

function normalizeName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchScore(record, place) {
  let score = 0;
  const recordName = normalizeName(record.name);
  const placeName = normalizeName(place?.name);
  if (recordName && placeName) {
    if (recordName === placeName) score += 100;
    else if (recordName.includes(placeName) || placeName.includes(recordName))
      score += 45;
  }
  const distance = Number(place?.distanceM);
  if (Number.isFinite(distance)) score += Math.max(0, 60 - distance / 10);
  const placeTypes = new Set(
    [place?.primaryType, ...(Array.isArray(place?.types) ? place.types : [])]
      .map((value) => String(value || '').toLowerCase())
      .filter(Boolean),
  );
  for (const type of CATEGORY_CONFIG[record.category]?.googleTypes || []) {
    if (placeTypes.has(String(type).toLowerCase())) score += 35;
  }
  return score;
}

export function createSecurityPointSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const cache = new Map();
  const inflight = new Map();

  async function fetchViewport(box, categories, { signal } = {}) {
    validateBox(box);
    const enabledCategories = sanitizeEnabledCategories(categories);
    if (!enabledCategories.length)
      return { records: [], stale: false, saturated: false };
    const key = queryKey(box, enabledCategories);
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    const request = (async () => {
      signal?.throwIfAborted();
      const response = await fetchImpl(OVERPASS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(buildOverpassQuery(box, enabledCategories))}`,
        signal,
      });
      if (!response.ok) {
        try {
          await response.body?.cancel();
        } catch {
          /* already closed */
        }
        throw new Error(
          response.status === 429
            ? 'Security Points are temporarily rate-limited'
            : response.status === 504
              ? 'Security Points query timed out'
              : 'Security Points are temporarily unavailable',
        );
      }
      const stale = response.headers.get('x-overpass-cache') === 'STALE';
      const payload = await response.json();
      signal?.throwIfAborted();
      if (!Array.isArray(payload?.elements) || payload.remark)
        throw new Error('Security Points returned an incomplete response');
      const deduped = new Map();
      for (const element of payload.elements.slice(0, QUERY_LIMIT)) {
        const record = normalizeRecord(element);
        if (!record || !enabledCategories.includes(record.category)) continue;
        deduped.set(record.id, record);
      }
      const result = {
        records: [...deduped.values()],
        stale,
        saturated: payload.elements.length >= QUERY_LIMIT,
      };
      boundedPush(cache, key, result);
      return result;
    })().finally(() => inflight.delete(key));
    inflight.set(key, request);
    return request;
  }

  async function enrichRecord(record, { signal } = {}) {
    if (!record || !Number.isFinite(record.latitude) || !Number.isFinite(record.longitude))
      return null;
    const types = CATEGORY_CONFIG[record.category]?.googleTypes || [];
    const query = new URLSearchParams({
      lat: record.latitude.toFixed(5),
      lon: record.longitude.toFixed(5),
      radiusM: record.category === 'airports' ? '900' : '250',
      maxResultCount: '8',
    });
    if (types.length) query.set('includedTypes', types.join(','));
    signal?.throwIfAborted();
    const response = await fetchImpl(`${GOOGLE_NEARBY_URL}?${query}`, { signal });
    const payload = await response.json();
    signal?.throwIfAborted();
    if (!response.ok || !Array.isArray(payload?.places)) return null;
    let best = null;
    let bestScore = -Infinity;
    for (const place of payload.places) {
      const score = matchScore(record, place);
      if (score > bestScore) {
        best = place;
        bestScore = score;
      }
    }
    if (!best || bestScore < 35) return null;
    return {
      name: best.name || null,
      address: best.address || null,
      phone: best.phone || null,
      primaryType: best.primaryType || null,
      googleMapsUri: best.googleMapsUri || null,
      provider: 'Google Maps Places',
      providerHref: 'https://policies.google.com/terms',
    };
  }

  return {
    async fetchViewport(box, categories, options = {}) {
      return fetchViewport(box, categories, options);
    },
    async enrichRecord(record, options = {}) {
      return enrichRecord(record, options);
    },
  };
}
