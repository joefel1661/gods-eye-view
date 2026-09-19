import {
  CATEGORY_CONFIG,
  CATEGORY_ORDER,
  DETAIL_REQUEST_TIMEOUT_MS,
  GOOGLE_NEARBY_URL,
  GOOGLE_PLACE_DETAILS_URL,
  GOOGLE_QUERY_LIMIT,
  MAX_VIEWPORT_DEGREES,
  OVERPASS_URL,
  QUERY_LIMIT,
  VIEWPORT_REQUEST_TIMEOUT_MS,
} from './policy.js';
import {
  buildSecurityPointsOverpassQuery,
  formatSecurityPointViewportValue,
} from './overpassQuery.js';
import { encodeOverpassFormBody } from '../../sources/overpass.js';

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
  return formatSecurityPointViewportValue(value);
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

const GOOGLE_PRIMARY_TYPE_TO_CATEGORY = Object.freeze({
  police: 'police',
  fire_station: 'fireEms',
  ambulance_service: 'fireEms',
  hospital: 'hospitals',
  emergency_room: 'hospitals',
  airport: 'airports',
  heliport: 'airports',
});

function normalizedGoogleType(value) {
  return String(value || '').trim().toLowerCase();
}

function inferGoogleCategory(place = {}, fallbackCategory = null) {
  const fromPrimary =
    GOOGLE_PRIMARY_TYPE_TO_CATEGORY[normalizedGoogleType(place.primaryType)] ||
    null;
  if (fromPrimary) return fromPrimary;
  const types = Array.isArray(place.types) ? place.types : [];
  for (const type of types) {
    const category = GOOGLE_PRIMARY_TYPE_TO_CATEGORY[normalizedGoogleType(type)];
    if (category) return category;
  }
  return fallbackCategory;
}

function googleTypeLabelForCategory(category, place = {}) {
  const type = normalizedGoogleType(place.primaryType);
  const name = String(place.name || '').trim();
  if (category === 'airports') return type === 'heliport' ? 'Heliport' : 'Airport';
  if (category === 'hospitals')
    return type === 'emergency_room' ? 'Emergency department' : 'Hospital';
  if (category === 'fireEms')
    return type === 'ambulance_service' ? 'EMS station' : 'Fire station';
  if (category === 'police')
    return /\bsheriff\b/i.test(name) ? 'Sheriff office' : 'Police facility';
  return 'Security point';
}

function placeQueryRadiusM(box, category) {
  const centerLat = (box.south + box.north) / 2;
  const centerLon = (box.west + box.east) / 2;
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos((centerLat * Math.PI) / 180);
  const northM = Math.abs((box.north - centerLat) * latitudeScale);
  const eastM = Math.abs((box.east - centerLon) * longitudeScale);
  const viewportRadius = Math.ceil(Math.hypot(northM, eastM));
  const categoryMinimum = category === 'airports' ? 1200 : 350;
  return Math.max(categoryMinimum, Math.min(5000, viewportRadius || categoryMinimum));
}

function normalizedGoogleRecord(place, requestedCategory) {
  const category = inferGoogleCategory(place, requestedCategory);
  if (!category) return null;
  const latitude = Number(place?.latitude);
  const longitude = Number(place?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const placeId = String(place?.id || '').trim() || null;
  const name =
    String(place?.name || '').trim() ||
    CATEGORY_CONFIG[category]?.cardLabel ||
    'Security Point';
  return {
    id: placeId
      ? `google:${placeId}`
      : `google:${category}:${formatViewportValue(latitude)}:${formatViewportValue(longitude)}`,
    googlePlaceId: placeId,
    osmType: null,
    osmId: null,
    category,
    name,
    typeLabel: googleTypeLabelForCategory(category, place),
    latitude,
    longitude,
    footprint: null,
    address: String(place?.address || '').trim() || null,
    phone: null,
    tags: {},
    provider: 'Google Maps Places',
    providerHref: 'https://maps.google.com',
    google: null,
  };
}

export function createSecurityPointSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  const cache = new Map();
  const inflight = new Map();

  async function fetchGoogleCategoryViewport(box, category, signal) {
    const types = CATEGORY_CONFIG[category]?.googleTypes || [];
    const centerLat = (box.south + box.north) / 2;
    const centerLon = (box.west + box.east) / 2;
    const query = new URLSearchParams({
      lat: centerLat.toFixed(6),
      lon: centerLon.toFixed(6),
      radiusM: String(placeQueryRadiusM(box, category)),
      maxResultCount: String(GOOGLE_QUERY_LIMIT),
    });
    if (types.length) query.set('includedTypes', types.join(','));
    const request = requestSignal(signal, VIEWPORT_REQUEST_TIMEOUT_MS);
    request.throwIfAborted();
    const startedAt = Date.now();
    logSecurityPointDiagnostic('google viewport request started', {
      endpoint: GOOGLE_NEARBY_URL,
      method: 'GET',
      category,
      bbox: bboxForLog(box),
      includedTypes: types,
    });
    let response;
    try {
      response = await fetchImpl(`${GOOGLE_NEARBY_URL}?${query}`, { signal: request });
    } catch (error) {
      const timeoutTriggered = request.aborted || isTimeoutError(error);
      logSecurityPointDiagnostic('google viewport request failed', {
        endpoint: GOOGLE_NEARBY_URL,
        method: 'GET',
        category,
        status: null,
        responseTimeMs: Date.now() - startedAt,
        timeoutTriggered,
        providerError: sanitizedErrorMessage(error),
      });
      throw new Error(
        timeoutTriggered
          ? 'Security Points query timed out'
          : 'Security Points are temporarily unavailable',
      );
    }
    const payload = await readResponseJsonSafe(response);
    request.throwIfAborted();
    if (!response.ok) {
      logSecurityPointDiagnostic('google viewport request failed', {
        endpoint: GOOGLE_NEARBY_URL,
        method: 'GET',
        category,
        status: response.status,
        responseTimeMs: Date.now() - startedAt,
        timeoutTriggered: response.status === 504,
        providerError: sanitizeProviderError(payload?.providerError || payload),
      });
      throw new Error(
        response.status === 429
          ? 'Security Points are temporarily rate-limited'
          : response.status === 403
            ? 'Security Points provider refused the request'
            : response.status === 504
              ? 'Security Points query timed out'
              : 'Security Points are temporarily unavailable',
      );
    }
    const places = Array.isArray(payload?.places) ? payload.places : [];
    logSecurityPointDiagnostic('google viewport request completed', {
      endpoint: GOOGLE_NEARBY_URL,
      method: 'GET',
      category,
      status: response.status,
      responseTimeMs: Date.now() - startedAt,
      resultCount: places.length,
      timeoutTriggered: false,
      providerError: null,
    });
    return { category, places, saturated: places.length >= GOOGLE_QUERY_LIMIT };
  }

  async function fetchGoogleViewport(box, enabledCategories, signal) {
    const settled = await Promise.allSettled(
      enabledCategories.map((category) =>
        fetchGoogleCategoryViewport(box, category, signal),
      ),
    );
    const deduped = new Map();
    let saturated = false;
    let failedCategories = 0;
    for (const entry of settled) {
      if (entry.status !== 'fulfilled') {
        failedCategories += 1;
        continue;
      }
      saturated ||= entry.value.saturated === true;
      for (const place of entry.value.places) {
        const record = normalizedGoogleRecord(place, entry.value.category);
        if (!record || !enabledCategories.includes(record.category)) continue;
        if (deduped.has(record.id)) continue;
        deduped.set(record.id, record);
      }
    }
    if (failedCategories > 0) {
      logSecurityPointDiagnostic('google viewport partial success', {
        enabledCategoryCount: enabledCategories.length,
        failedCategoryCount: failedCategories,
        resultCount: deduped.size,
        bbox: bboxForLog(box),
      });
    }
    const primaryError = settled.find((entry) => entry.status === 'rejected');
    if (!deduped.size && failedCategories === enabledCategories.length && primaryError)
      throw primaryError.reason || new Error('Security Points unavailable');
    return { records: [...deduped.values()], saturated, failedCategories };
  }

  async function fetchOverpassFallback(box, enabledCategories, signal) {
    const requests = enabledCategories.map(async (category) => {
      const query = buildSecurityPointsOverpassQuery(box, [category], {
        queryLimit: QUERY_LIMIT,
        timeoutSec: 25,
      });
      const requestBody = encodeOverpassFormBody(query);
      const request = requestSignal(signal, VIEWPORT_REQUEST_TIMEOUT_MS);
      request.throwIfAborted();
      const startedAt = Date.now();
      logSecurityPointDiagnostic('overpass viewport request started', {
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
        logSecurityPointDiagnostic('overpass viewport request failed', {
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
        const timeoutTriggered =
          response.status === 504 || isTimeoutError({ message: bodyText });
        logSecurityPointDiagnostic('overpass viewport request failed', {
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
          providerError: bodyText ? bodyText.slice(0, 240) : 'No response body',
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
        logSecurityPointDiagnostic('overpass viewport request failed', {
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
      logSecurityPointDiagnostic('overpass viewport request completed', {
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
    const deduped = new Map();
    let stale = false;
    let saturated = false;
    for (const entry of settled) {
      if (entry.status !== 'fulfilled') continue;
      stale ||= entry.value.stale === true;
      saturated ||= entry.value.saturated === true;
      for (const element of entry.value.elements) {
        const record = normalizeRecord(element);
        if (!record || !enabledCategories.includes(record.category)) continue;
        deduped.set(record.id, record);
      }
    }
    const succeeded = settled.some((entry) => entry.status === 'fulfilled');
    if (!succeeded) {
      const primaryError = settled.find((entry) => entry.status === 'rejected');
      throw primaryError?.reason || new Error('Security Points unavailable');
    }
    return { records: [...deduped.values()], stale, saturated };
  }

  async function fetchViewport(box, categories, { signal } = {}) {
    validateBox(box);
    const enabledCategories = sanitizeEnabledCategories(categories);
    if (!enabledCategories.length)
      return { records: [], stale: false, saturated: false };
    const key = queryKey(box, enabledCategories);
    if (cache.has(key)) return cache.get(key);
    if (inflight.has(key)) return inflight.get(key);
    const pending = (async () => {
      try {
        const googleResult = await fetchGoogleViewport(box, enabledCategories, signal);
        const result = {
          records: googleResult.records,
          stale: false,
          saturated: googleResult.saturated,
        };
        boundedPush(cache, key, result);
        return result;
      } catch (error) {
        logSecurityPointDiagnostic('google primary unavailable, trying overpass fallback', {
          bbox: bboxForLog(box),
          enabledCategories,
          message: sanitizedErrorMessage(error),
        });
        const fallback = await fetchOverpassFallback(box, enabledCategories, signal);
        boundedPush(cache, key, fallback);
        return fallback;
      }
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
    return pending;
  }

  async function enrichRecord(record, { signal } = {}) {
    const placeId = String(record?.googlePlaceId || '').trim();
    if (!placeId) return null;
    const request = requestSignal(signal, DETAIL_REQUEST_TIMEOUT_MS);
    request.throwIfAborted();
    const response = await fetchImpl(
      `${GOOGLE_PLACE_DETAILS_URL}?${new URLSearchParams({ placeId })}`,
      { signal: request },
    );
    const payload = await readResponseJsonSafe(response);
    request.throwIfAborted();
    if (!response.ok) {
      logSecurityPointDiagnostic('detail request failed', {
        endpoint: GOOGLE_PLACE_DETAILS_URL,
        method: 'GET',
        status: response.status,
        providerError: sanitizeProviderError(payload?.providerError || payload),
      });
      return null;
    }
    const place = payload?.place;
    if (!place || typeof place !== 'object') return null;
    const phone = String(place?.phone || '').trim() || null;
    return {
      name: String(place?.name || '').trim() || null,
      address: String(place?.address || '').trim() || null,
      phone,
      primaryType:
        String(place?.primaryType || '').trim() ||
        googleTypeLabelForCategory(record?.category, place),
      googleMapsUri: String(place?.googleMapsUri || '').trim() || null,
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
