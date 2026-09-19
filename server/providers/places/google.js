import {
  googleServerApiKey,
  googleServerKeyMode,
  keylessGooglePlacesResponse,
} from './google-key.js';
import { makeOptInRateLimiter, clientKey } from '../common/rate-limit.js';
import {
  projectNearbyPlaces,
  projectTextSearchPlaces,
} from '../../../src/data/placeProviderPayloads.js';

const GOOGLE_PLACES_UPSTREAM_TIMEOUT_MS = 10_000;
const GOOGLE_PLACES_HEALTH_DEFAULTS = Object.freeze({
  latitude: 30.2672,
  longitude: -97.7431,
  radiusM: 50,
});

// Construct lazily after the standalone environment has loaded.
// undefined = not built yet; null = unlimited; fn = active limiter
let _googleRateLimiter;

/** Google cost endpoint (nearby-places). Null = unlimited (default). */
function googleRateLimiter() {
  if (_googleRateLimiter === undefined)
    _googleRateLimiter = makeOptInRateLimiter(
      process.env.GEV_RATELIMIT_GOOGLE_PER_MIN,
    );
  return _googleRateLimiter;
}

function sanitizeGoogleError(data = {}) {
  const provider = data?.error || {};
  const code = Number(provider?.code);
  return {
    code: Number.isFinite(code) ? code : null,
    status: String(provider?.status || '').trim() || null,
    message: String(provider?.message || '').trim() || null,
  };
}

function logGoogleFailure(endpoint, response, data) {
  console.warn('[GooglePlaces]', {
    endpoint,
    method: 'POST',
    status: response.status,
    keyMode: googleServerKeyMode(),
    providerError: sanitizeGoogleError(data),
  });
}

function googleEndpointDetail(endpoint) {
  const target = new URL(endpoint);
  return {
    hostname: target.hostname,
    path: target.pathname,
  };
}

function isGoogleTimeoutError(error, controller) {
  return Boolean(
    error?.name === 'TimeoutError' ||
      (error?.name === 'AbortError' && controller?.signal?.aborted),
  );
}

function googleProxyErrorMessage(status, providerError) {
  if (providerError?.message) return providerError.message;
  return Number.isFinite(status) && status > 0
    ? `Google Places returned HTTP ${status}`
    : 'Google Places request failed';
}

async function executeGooglePlacesRequest({
  route,
  endpoint,
  apiKey,
  fieldMask,
  body,
  fetchImpl,
}) {
  const endpointDetail = googleEndpointDetail(endpoint);
  const startedAt = Date.now();
  const controller = new AbortController();
  let timeoutTriggered = false;
  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort(
      new DOMException('Google Places upstream timeout', 'TimeoutError'),
    );
  }, GOOGLE_PLACES_UPSTREAM_TIMEOUT_MS);
  console.info('[GooglePlaces] request begins', {
    route,
    endpoint: endpointDetail,
    method: 'POST',
    keyMode: googleServerKeyMode(),
    serverKeyConfigured: Boolean(
      String(process.env.GOOGLE_MAPS_SERVER_API_KEY || '').trim(),
    ),
    timeoutMs: GOOGLE_PLACES_UPSTREAM_TIMEOUT_MS,
  });
  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    const providerError = response.ok ? null : sanitizeGoogleError(data);
    const elapsedMs = Date.now() - startedAt;
    const logPayload = {
      route,
      endpoint: endpointDetail,
      method: 'POST',
      status: response.status,
      providerError,
      elapsedMs,
      timeoutTriggered,
    };
    if (response.ok) console.info('[GooglePlaces] request completed', logPayload);
    else {
      console.warn('[GooglePlaces] request completed', logPayload);
      logGoogleFailure(route, response, data);
    }
    return {
      response,
      data,
      elapsedMs,
      timeoutTriggered,
      providerError,
      endpointDetail,
    };
  } catch (error) {
    const elapsedMs = Date.now() - startedAt;
    const timedOut = timeoutTriggered || isGoogleTimeoutError(error, controller);
    console.warn('[GooglePlaces] request failed', {
      route,
      endpoint: endpointDetail,
      method: 'POST',
      status: null,
      providerError: null,
      elapsedMs,
      timeoutTriggered: timedOut,
      error: timedOut
        ? 'Google Places upstream timeout'
        : String(error?.message || '').trim() || null,
    });
    const wrapped = new Error(
      timedOut ? 'Google Places upstream timeout' : 'Google Places request failed',
    );
    wrapped.cause = error;
    wrapped.statusCode = timedOut ? 504 : 502;
    wrapped.timeoutTriggered = timedOut;
    wrapped.elapsedMs = elapsedMs;
    wrapped.endpointDetail = endpointDetail;
    throw wrapped;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Validate raw lat/lon presence and WGS84 bounds before consuming request quota. */
export function validatePlacesCoordinates(searchParams) {
  const rawLat = searchParams.get('lat');
  const rawLon = searchParams.get('lon');
  if (rawLat === null || rawLon === null || !rawLat.trim() || !rawLon.trim()) {
    return { ok: false, error: 'lat and lon are required' };
  }
  const latitude = Number(rawLat);
  const longitude = Number(rawLon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, error: 'Valid lat and lon are required' };
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return {
      ok: false,
      error: 'lat must be within [-90, 90] and lon within [-180, 180]',
    };
  }
  return { ok: true, latitude, longitude };
}

/** Nearby place labels and view-biased text search, with request-time key resolution. */
export function googlePlacesContextProxy({
  resolveApiKey = googleServerApiKey,
  fetchImpl = (...args) => fetch(...args),
  endpoints = {},
} = {}) {
  function install(middlewares) {
    middlewares.use('/api/google/health', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      const apiKey = resolveApiKey();
      const requestUrl = new URL(req.url || '', 'http://localhost');
      const coordinates = validatePlacesCoordinates(requestUrl.searchParams);
      if (!coordinates.ok && requestUrl.searchParams.has('lat')) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: coordinates.error }));
        return;
      }
      const latitude = coordinates.ok
        ? coordinates.latitude
        : GOOGLE_PLACES_HEALTH_DEFAULTS.latitude;
      const longitude = coordinates.ok
        ? coordinates.longitude
        : GOOGLE_PLACES_HEALTH_DEFAULTS.longitude;
      const radiusM = Math.max(
        1,
        Math.min(
          5000,
          Number(requestUrl.searchParams.get('radiusM')) ||
            GOOGLE_PLACES_HEALTH_DEFAULTS.radiusM,
        ),
      );
      const serverKeyConfigured = Boolean(
        String(process.env.GOOGLE_MAPS_SERVER_API_KEY || '').trim(),
      );
      const endpoint =
        endpoints.nearby || 'https://places.googleapis.com/v1/places:searchNearby';
      const responseBody = {
        serverKeyConfigured,
        keyMode: googleServerKeyMode(),
        reachable: false,
        httpStatus: null,
        latencyMs: null,
        timeoutTriggered: false,
        endpoint: googleEndpointDetail(endpoint),
        method: 'POST',
        providerError: null,
      };
      if (!String(apiKey || '').trim()) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(responseBody));
        return;
      }

      try {
        const probe = await executeGooglePlacesRequest({
          route: '/api/google/health',
          endpoint,
          apiKey,
          fieldMask: 'places.id',
          body: {
            maxResultCount: 1,
            rankPreference: 'DISTANCE',
            locationRestriction: {
              circle: {
                center: { latitude, longitude },
                radius: radiusM,
              },
            },
          },
          fetchImpl,
        });
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({
            ...responseBody,
            reachable: true,
            httpStatus: probe.response.status,
            latencyMs: probe.elapsedMs,
            timeoutTriggered: probe.timeoutTriggered,
            providerError: probe.providerError,
          }),
        );
      } catch (error) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(
          JSON.stringify({
            ...responseBody,
            latencyMs: error?.elapsedMs ?? null,
            timeoutTriggered: error?.timeoutTriggered === true,
          }),
        );
      }
    });

    middlewares.use('/api/google/nearby-places', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed', places: [] }));
        return;
      }

      // Keyless place context has no provider cost, so it resolves before the
      // paid-endpoint limiter can consume or exhaust quota (mirrors the HUD
      // summary route).
      const apiKey = resolveApiKey();
      const keyless = keylessGooglePlacesResponse(apiKey);
      if (keyless) {
        res.statusCode = keyless.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(keyless.payload));
        return;
      }

      const requestUrl = new URL(req.url || '', 'http://localhost');
      const coordinates = validatePlacesCoordinates(requestUrl.searchParams);
      if (!coordinates.ok) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: coordinates.error, places: [] }));
        return;
      }
      const { latitude, longitude } = coordinates;

      // Opt-in per-IP throttle (GEV_RATELIMIT_GOOGLE_PER_MIN). No-op when unset.
      // Inlined (not the shared helper) so the 429 body keeps this endpoint's
      // `places: []` contract that the client expects on every error response.
      const _grl = googleRateLimiter();
      if (_grl && !_grl(clientKey(req))) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', '5');
        res.end(JSON.stringify({ error: 'Rate limit exceeded', places: [] }));
        return;
      }

      const radiusM = Math.max(
        25,
        Math.min(5000, Number(requestUrl.searchParams.get('radiusM')) || 250),
      );
      const maxResultCount = Math.max(
        1,
        Math.min(
          20,
          Number(requestUrl.searchParams.get('maxResultCount')) || 20,
        ),
      );
      const includedTypes = String(
        requestUrl.searchParams.get('includedTypes') || '',
      )
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .slice(0, 10        );

        try {
          const { response, data, providerError } = await executeGooglePlacesRequest(
            {
              route: '/api/google/nearby-places',
              endpoint:
                endpoints.nearby ||
                'https://places.googleapis.com/v1/places:searchNearby',
              apiKey,
              fieldMask: [
                'places.id',
                'places.displayName',
                'places.formattedAddress',
                'places.shortFormattedAddress',
                'places.location',
                'places.primaryType',
                'places.primaryTypeDisplayName',
                'places.types',
                'places.nationalPhoneNumber',
                'places.internationalPhoneNumber',
                'places.googleMapsUri',
              ].join(','),
              body: {
                maxResultCount,
                rankPreference: 'DISTANCE',
                ...(includedTypes.length ? { includedTypes } : {}),
                locationRestriction: {
                  circle: {
                    center: { latitude, longitude },
                    radius: radiusM,
                  },
                },
              },
              fetchImpl,
            },
          );
          const places = projectNearbyPlaces(data, latitude, longitude);
          res.statusCode = response.ok ? 200 : response.status;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'private, max-age=300');
          res.end(
            JSON.stringify({
              places,
              error: response.ok
                ? null
                : googleProxyErrorMessage(response.status, providerError),
              providerError,
            }),
          );
        } catch (error) {
          res.statusCode = error?.statusCode || 502;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              error: error?.message || 'Google Places request failed',
              places: [],
              providerError: null,
            }),
          );
        }
    });

    // Text Search: resolve a named landmark/POI to a real coordinate, biased to
    // the view. Geocoding scatters obscure monument/POI names across the city;
    // a view-biased Text Search lands on the actual feature. Same key, field
    // mask, throttle, and `places: []` error contract as nearby-places above.
    middlewares.use('/api/google/text-search', async (req, res) => {
      if (req.method !== 'GET') {
        res.statusCode = 405;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Method not allowed', places: [] }));
        return;
      }

      // Keyless place context has no provider cost, so it resolves before the
      // paid-endpoint limiter can consume or exhaust quota (mirrors the HUD
      // summary route).
      const apiKey = resolveApiKey();
      const keyless = keylessGooglePlacesResponse(apiKey);
      if (keyless) {
        res.statusCode = keyless.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(keyless.payload));
        return;
      }

      const requestUrl = new URL(req.url || '', 'http://localhost');
      const textQuery = String(requestUrl.searchParams.get('q') || '').trim();
      if (!textQuery) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(
          JSON.stringify({ error: 'q, lat and lon are required', places: [] }),
        );
        return;
      }
      const coordinates = validatePlacesCoordinates(requestUrl.searchParams);
      if (!coordinates.ok) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: coordinates.error, places: [] }));
        return;
      }
      const { latitude, longitude } = coordinates;

      // Opt-in per-IP throttle (GEV_RATELIMIT_GOOGLE_PER_MIN). No-op when unset.
      // Inlined (like nearby-places) so the 429 body keeps the `places: []`
      // contract the client expects on every error response.
      const _grl = googleRateLimiter();
      if (_grl && !_grl(clientKey(req))) {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Retry-After', '5');
        res.end(JSON.stringify({ error: 'Rate limit exceeded', places: [] }));
        return;
      }

      const radiusM = Math.max(
        50,
        Math.min(50000, Number(requestUrl.searchParams.get('radiusM')) || 4000),
      );

      try {
        const { response, data, providerError } = await executeGooglePlacesRequest(
          {
            route: '/api/google/text-search',
            endpoint:
              endpoints.textSearch ||
              'https://places.googleapis.com/v1/places:searchText',
            apiKey,
            fieldMask: [
              'places.id',
              'places.displayName',
              'places.formattedAddress',
              'places.location',
              'places.viewport',
              'places.primaryType',
              'places.types',
            ].join(','),
            body: {
              textQuery,
              locationBias: {
                circle: {
                  center: { latitude, longitude },
                  radius: radiusM,
                },
              },
              maxResultCount: 5,
            },
            fetchImpl,
          },
        );
        const places = projectTextSearchPlaces(data, latitude, longitude);
        res.statusCode = response.ok ? 200 : response.status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'private, max-age=300');
        res.end(
          JSON.stringify({
            places,
            error: response.ok
              ? null
              : googleProxyErrorMessage(response.status, providerError),
            providerError,
          }),
        );
      } catch (error) {
        res.statusCode = error?.statusCode || 502;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            error: error?.message || 'Google Places request failed',
            places: [],
            providerError: null,
          }),
        );
      }
    });
  }

  return {
    name: 'google-places-context-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}
