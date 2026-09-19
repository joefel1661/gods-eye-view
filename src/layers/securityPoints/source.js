import {
  CATEGORY_CONFIG,
  CATEGORY_ORDER,
  DETAIL_REQUEST_TIMEOUT_MS,
  GOOGLE_NEARBY_URL,
  MAX_VIEWPORT_DEGREES,
  OVERPASS_URL,
  QUERY_LIMIT,
  VIEWPORT_REQUEST_TIMEOUT_MS,
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
    clauses.push(`node["office"="government"]["name"~"sheriff",i]${bbox};`);
    clauses.push(`way["office"="government"]["name"~"sheriff",i]${bbox};`);
    clauses.push(`relation["office"="government"]["name"~"sheriff",i]${bbox};`);
    clauses.push(`node["law_enforcement"="sheriff"]${bbox};`);
    clauses.push(`way["law_enforcement"="sheriff"]${bbox};`);
    clauses.push(`relation["law_enforcement"="sheriff"]${bbox};`);
  }
  if (enabledCategories.includes('fireEms')) {
    clauses.push(`node["amenity"="fire_station"]${bbox};`);
    clauses.push(`way["amenity"="fire_station"]${bbox};`);
    clauses.push(`relation["amenity"="fire_station"]${bbox};`);
    clauses.push(`node["emergency"="fire_station"]${bbox};`);
    clauses.push(`way["emergency"="fire_station"]${bbox};`);
    clauses.push(`relation["emergency"="fire_station"]${bbox};`);
    clauses.push(`node["amenity"="ambulance_station"]${bbox};`);
    clauses.push(`way["amenity"="ambulance_station"]${bbox};`);
    clauses.push(`relation["amenity"="ambulance_station"]${bbox};`);
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
    clauses.push(`node["aeroway"="airport"]${bbox};`);
    clauses.push(`way["aeroway"="airport"]${bbox};`);
    clauses.push(`relation["aeroway"="airport"]${bbox};`);
    clauses.push(`node["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`way["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`relation["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`node["aeroway"="heliport"]${bbox};`);
    clauses.push(`way["aeroway"="heliport"]${bbox};`);
    clauses.push(`relation["aeroway"="heliport"]${bbox};`);
  }
  return `[out:json][timeout:25];(\n${clauses.join('\n')}\n);out tags center ${QUERY_LIMIT};`;
}

function formatAddress(tags = {}) {
  const street = [tags['addr:housenumber'], tags['addr:street']]
    .filter(Boolean)
    .join(' ')
    .trim();
  const locality = [
    tags['addr:city'],
    tags['addr:state'],
    tags['addr:postcode'],
  ]
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
  if (
    aeroway === 'airport' ||
    aeroway === 'aerodrome' ||
    aeroway === 'heliport'
  )
    return 'airports';
  const emergency = String(tags.emergency || '').toLowerCase();
  const amenity = String(tags.amenity || '').toLowerCase();
  const healthcare = String(tags.healthcare || '').toLowerCase();
  const office = String(tags.office || '').toLowerCase();
  const lawEnforcement = String(tags.law_enforcement || '').toLowerCase();
  const name = String(tags.name || '').toLowerCase();
  if (
    amenity === 'hospital' ||
    healthcare === 'hospital' ||
    emergency === 'emergency_ward' ||
    emergency === 'emergency_department'
  )
    return 'hospitals';
  if (
    amenity === 'fire_station' ||
    emergency === 'fire_station' ||
    amenity === 'ambulance_station' ||
    emergency === 'ambulance_station'
  )
    return 'fireEms';
  if (
    amenity === 'police' ||
    lawEnforcement === 'sheriff' ||
    (office === 'government' && /\bsheriff\b/.test(name))
  )
    return 'police';
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
    if (
      String(tags.emergency || '').toLowerCase() === 'ambulance_station' ||
      String(tags.amenity || '').toLowerCase() === 'ambulance_station'
    )
      return 'EMS station';
    return 'Fire station';
  }
  if (category === 'police')
    return /\bsheriff\b/i.test(String(tags.name || ''))
      ? 'Sheriff office'
      : 'Police facility';
  return 'Security point';
}

function hasReliableFootprintTags(tags = {}, category = null) {
  if (category === 'airports') return false;
  const building = String(
    tags.building || tags['building:part'] || '',
  ).toLowerCase();
  return Boolean(building) && building !== 'no' && building !== 'roof';
}

function normalizeFootprint(element, tags, category) {
  if (!hasReliableFootprintTags(tags, category)) return null;
  const geometry = Array.isArray(element?.geometry) ? element.geometry : null;
  if (!geometry || geometry.length < 3) return null;
  const ring = geometry
    .filter(
      (point) => Number.isFinite(point?.lon) && Number.isFinite(point?.lat),
    )
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
  const footprint = normalizeFootprint(element, tags, category);
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

function requestSignal(signal, timeoutMs) {
  return signal
    ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
    : AbortSignal.timeout(timeoutMs);
}

function readResponseJsonSafe(response) {
  return response.json().catch(() => ({}));
}

function sanitizeProviderError(error) {
  if (!error || typeof error !== 'object') return null;
  const status =
    Number.isFinite(error.code) && error.code > 0 ? Number(error.code) : null;
  const reason = String(error.status || '').trim() || null;
  const message = String(error.message || '').trim() || null;
  return { status, reason, message };
}

function logSecurityPointDiagnostic(scope, detail) {
  console.warn(`[SecurityPoints] ${scope}`, detail);
}

function isTimeoutError(error) {
  if (!error) return false;
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    name === 'timeouterror' ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

function sanitizedErrorMessage(error) {
  const message = String(error?.message || '').trim();
  return message ? message.slice(0, 240) : 'Request failed';
}

function endpointHostFromHeader(value) {
  try {
    return new URL(String(value || '')).hostname || null;
  } catch {
    return null;
  }
}

function bboxForLog(box) {
  return {
    south: formatViewportValue(box.south),
    west: formatViewportValue(box.west),
    north: formatViewportValue(box.north),
    east: formatViewportValue(box.east),
  };
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
    const pending = (async () => {
      const requests = enabledCategories.map(async (category) => {
        const query = buildOverpassQuery(box, [category]);
        const requestBody = `data=${encodeURIComponent(query)}`;
        const request = requestSignal(signal, VIEWPORT_REQUEST_TIMEOUT_MS);
        request.throwIfAborted();
        const startedAt = Date.now();
        logSecurityPointDiagnostic('viewport request started', {
          endpoint: OVERPASS_URL,
          endpointHost: null,
          method: 'POST',
          category,
          querySize: query.length,
          bbox: bboxForLog(box),
        });
        let response;
        try {
          response = await fetchImpl(OVERPASS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: requestBody,
            signal: request,
          });
        } catch (error) {
          const elapsedMs = Date.now() - startedAt;
          const timeoutTriggered = request.aborted || isTimeoutError(error);
          logSecurityPointDiagnostic('viewport request failed', {
            endpoint: OVERPASS_URL,
            endpointHost: null,
            method: 'POST',
            category,
            querySize: query.length,
            bbox: bboxForLog(box),
            status: null,
            responseTimeMs: elapsedMs,
            responseSize: null,
            resultCount: 0,
            timeoutTriggered,
            providerError: sanitizedErrorMessage(error),
          });
          throw new Error(
            timeoutTriggered
              ? 'Security Points query timed out'
              : 'Security Points are temporarily unavailable',
          );
        }
        const elapsedMs = Date.now() - startedAt;
        const stale = response.headers.get('x-overpass-cache') === 'STALE';
        const endpointHost = endpointHostFromHeader(
          response.headers.get('x-overpass-upstream'),
        );
        const contentLength = Number(response.headers.get('content-length'));
        if (!response.ok) {
          const bodyText = await response.text().catch(() => '');
          try {
            await response.body?.cancel();
          } catch {
            /* already closed */
          }
          const timeoutTriggered =
            response.status === 504 || isTimeoutError({ message: bodyText });
          logSecurityPointDiagnostic('viewport request failed', {
            endpoint: OVERPASS_URL,
            endpointHost,
            method: 'POST',
            category,
            querySize: query.length,
            bbox: bboxForLog(box),
            status: response.status,
            responseTimeMs: elapsedMs,
            responseSize: Number.isFinite(contentLength)
              ? contentLength
              : bodyText.length,
            resultCount: 0,
            timeoutTriggered,
            providerError: bodyText
              ? bodyText.slice(0, 240)
              : 'No response body',
          });
          throw new Error(
            response.status === 429
              ? 'Security Points are temporarily rate-limited'
              : timeoutTriggered
                ? 'Security Points query timed out'
                : response.status === 403
                  ? 'Security Points provider refused the request'
                  : 'Security Points are temporarily unavailable',
          );
        }
        const payload = await response.json();
        request.throwIfAborted();
        if (!Array.isArray(payload?.elements) || payload.remark) {
          logSecurityPointDiagnostic('viewport request failed', {
            endpoint: OVERPASS_URL,
            endpointHost,
            method: 'POST',
            category,
            querySize: query.length,
            bbox: bboxForLog(box),
            status: response.status,
            responseTimeMs: elapsedMs,
            responseSize: Number.isFinite(contentLength) ? contentLength : null,
            resultCount: 0,
            timeoutTriggered: false,
            providerError:
              String(payload?.remark || '').slice(0, 240) ||
              'Security Points returned an incomplete response',
          });
          throw new Error('Security Points returned an incomplete response');
        }
        logSecurityPointDiagnostic('viewport request completed', {
          endpoint: OVERPASS_URL,
          endpointHost,
          method: 'POST',
          category,
          querySize: query.length,
          bbox: bboxForLog(box),
          status: response.status,
          responseTimeMs: elapsedMs,
          responseSize: Number.isFinite(contentLength) ? contentLength : null,
          resultCount: payload.elements.length,
          timeoutTriggered: false,
          providerError: null,
        });
        return {
          category,
          stale,
          saturated: payload.elements.length >= QUERY_LIMIT,
          elements: payload.elements.slice(0, QUERY_LIMIT),
        };
      });
      const settled = await Promise.allSettled(requests);
      const succeeded = settled.filter((entry) => entry.status === 'fulfilled');
      if (!succeeded.length) {
        const primaryError = settled.find(
          (entry) => entry.status === 'rejected',
        );
        throw primaryError?.reason || new Error('Security Points unavailable');
      }
      const deduped = new Map();
      let stale = false;
      let saturated = false;
      let failedCategories = 0;
      for (const entry of settled) {
        if (entry.status !== 'fulfilled') {
          failedCategories += 1;
          continue;
        }
        stale ||= entry.value.stale === true;
        saturated ||= entry.value.saturated === true;
        for (const element of entry.value.elements) {
          const record = normalizeRecord(element);
          if (!record || !enabledCategories.includes(record.category)) continue;
          deduped.set(record.id, record);
        }
      }
      if (failedCategories > 0) {
        logSecurityPointDiagnostic('viewport request partial success', {
          enabledCategoryCount: enabledCategories.length,
          failedCategoryCount: failedCategories,
          resultCount: deduped.size,
          bbox: bboxForLog(box),
        });
      }
      const result = { records: [...deduped.values()], stale, saturated };
      boundedPush(cache, key, result);
      return result;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  async function enrichRecord(record, { signal } = {}) {
    if (
      !record ||
      !Number.isFinite(record.latitude) ||
      !Number.isFinite(record.longitude)
    )
      return null;
    const types = CATEGORY_CONFIG[record.category]?.googleTypes || [];
    const query = new URLSearchParams({
      lat: record.latitude.toFixed(5),
      lon: record.longitude.toFixed(5),
      radiusM: record.category === 'airports' ? '900' : '250',
      maxResultCount: '8',
    });
    if (types.length) query.set('includedTypes', types.join(','));
    const request = requestSignal(signal, DETAIL_REQUEST_TIMEOUT_MS);
    request.throwIfAborted();
    const response = await fetchImpl(`${GOOGLE_NEARBY_URL}?${query}`, {
      signal: request,
    });
    const payload = await readResponseJsonSafe(response);
    request.throwIfAborted();
    if (!response.ok) {
      logSecurityPointDiagnostic('detail request failed', {
        endpoint: GOOGLE_NEARBY_URL,
        method: 'GET',
        status: response.status,
        providerError: sanitizeProviderError(payload?.error || payload),
      });
      return null;
    }
    if (!Array.isArray(payload?.places)) return null;
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
