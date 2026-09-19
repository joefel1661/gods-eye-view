import { makeRateLimiter, clientKey } from './common/rate-limit.js';
import { readRequestBodyCapped } from './common/request.js';
import {
  OVERPASS_MAX_BODY_BYTES,
  OVERPASS_MAX_CONCURRENT,
  OVERPASS_MAX_RESPONSE_BYTES,
  OVERPASS_TIMEOUT_MS,
  OVERPASS_UPSTREAMS,
} from './overpass/constants.js';
import { sanitizeOverpassBody } from './overpass/query.js';
import {
  resolveOverpassPreflight,
  _overpassCache,
  readOverpassDisk,
  overpassDiskTtlMs,
  readStaleOverpass,
  trimOverpassCache,
  writeOverpassDisk,
} from './overpass/cache.js';
import {
  overpassPayloadIsData,
  fetchOverpassPayload,
  sanitizeOverpassProviderText,
} from './overpass/transport.js';
import { installRouteMiddleware } from './places/routes.js';
import { encodeOverpassFormBody } from '../../src/sources/overpass.js';
import { readResponseTextCapped } from './common/http.js';
import { CATEGORY_ORDER } from '../../src/layers/securityPoints/policy.js';
import {
  buildSecurityPointsOverpassQuery,
  formatSecurityPointViewportValue,
} from '../../src/layers/securityPoints/overpassQuery.js';

/** @type {Map<string,Promise>} In-flight Overpass requests keyed by normalized query body. */
const _overpassInFlight = new Map();

let _overpassConcurrent = 0;

const _overpassRateLimiter = makeRateLimiter({
  windowMs: 60_000,
  max: 90,
  globalMax: 300,
});

const OVERPASS_HEALTH_DEFAULTS = Object.freeze({
  south: 30.267,
  west: -97.744,
  north: 30.268,
  east: -97.742,
});

function overpassEndpointDetail(endpoint) {
  try {
    const target = new URL(String(endpoint || ''));
    return {
      hostname: target.hostname || null,
      path: target.pathname || null,
    };
  } catch {
    return { hostname: null, path: null };
  }
}

function clampCoordinate(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
}

function overpassHealthQuery(box) {
  return buildSecurityPointsOverpassQuery(box, CATEGORY_ORDER);
}

function overpassTinyHealthQuery({ south, west, north, east }) {
  return `[out:json][timeout:10];node["amenity"="police"](${south},${west},${north},${east});out tags 1;`;
}

function overpassPrimaryHealthEndpoint() {
  return String(OVERPASS_UPSTREAMS?.[0] || '');
}

async function fetchOverpassGetDataProbe(body) {
  const endpoint = overpassPrimaryHealthEndpoint();
  const target = new URL(endpoint);
  const params = new URLSearchParams(String(body || ''));
  for (const [key, value] of params) target.searchParams.append(key, value);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const upstream = await fetch(target, {
      method: 'GET',
      signal: controller.signal,
    });
    const responseBody = await readResponseTextCapped(
      upstream,
      OVERPASS_MAX_RESPONSE_BYTES,
    );
    const contentType =
      upstream.headers.get('content-type') || 'application/json';
    const status = upstream.status;
    const providerError = sanitizeOverpassProviderText(responseBody, contentType);
    return {
      status,
      body: responseBody,
      contentType,
      endpoint,
      providerError,
      attempts: [
        {
          endpoint,
          method: 'GET',
          status,
          latencyMs: Date.now() - startedAt,
          timeoutTriggered: false,
          providerError,
        },
      ],
      fallbackAttempted: false,
      finalEndpoint: status >= 200 && status < 300 ? endpoint : null,
    };
  } catch (error) {
    throw Object.assign(error, {
      attempts: [
        {
          endpoint,
          method: 'GET',
          status: null,
          latencyMs: Date.now() - startedAt,
          timeoutTriggered:
            error?.name === 'AbortError' || error?.name === 'TimeoutError',
          providerError: String(error?.message || '').trim().slice(0, 240) || null,
        },
      ],
      fallbackAttempted: false,
      providerError: String(error?.message || '').trim().slice(0, 240) || null,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function overpassTimeoutTriggered(error, payload = null) {
  if (payload?.runtimeError) return true;
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  return (
    name === 'aborterror' ||
    name === 'timeouterror' ||
    message.includes('timed out') ||
    message.includes('timeout')
  );
}

function overpassResultCount(payload) {
  try {
    const parsed = JSON.parse(String(payload?.body || '{}'));
    return Array.isArray(parsed?.elements) ? parsed.elements.length : 0;
  } catch {
    return 0;
  }
}

function sanitizeOverpassError(error) {
  const message = String(error?.message || '').trim();
  return message ? message.slice(0, 240) : null;
}

function summarizeOverpassAttempts(attempts = []) {
  return attempts.map((attempt) => ({
    endpoint: overpassEndpointDetail(attempt?.endpoint),
    method: String(attempt?.method || 'POST'),
    httpStatus: Number.isFinite(attempt?.status) ? Number(attempt.status) : null,
    latencyMs: Number.isFinite(attempt?.latencyMs)
      ? Number(attempt.latencyMs)
      : null,
    timeoutTriggered: attempt?.timeoutTriggered === true,
    providerError: String(attempt?.providerError || '').trim() || null,
  }));
}

/**
 * Write a completed Overpass payload to the HTTP response.
 *
 * @param {import('http').ServerResponse} res - Node HTTP response.
 * @param {{status:number,body:string,contentType:string,endpoint:string}} payload
 * @param {string} [cacheStatus='MISS'] - 'HIT', 'MISS', or 'INFLIGHT'.
 */
function sendOverpassResponse(res, payload, cacheStatus = 'MISS') {
  res.writeHead(payload.status, {
    'Content-Type': payload.contentType || 'application/json',
    'Cache-Control': 'public, max-age=15',
    'X-Overpass-Cache': cacheStatus,
    'X-Overpass-Upstream': payload.endpoint || 'unknown',
  });
  res.end(payload.body || '');
}

/**
 * Vite plugin: Overpass API proxy with response caching and request coalescing.
 *
 * Accepts POST requests at /api/overpass, normalizes the query body for
 * cache keying, and fans out to multiple Overpass mirrors with per-upstream
 * timeout and rate-limit detection. Successful responses are cached for
 * OVERPASS_CACHE_MS. Concurrent identical queries share a single upstream
 * request via the in-flight map.
 *
 * @returns {import('vite').Plugin}
 */
function overpassProxy({ routing = {} } = {}) {
  const installMiddleware = (server) => {
    server.middlewares.use('/api/overpass/health', async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Method Not Allowed' }));
        return;
      }
      const requestUrl = new URL(req.url || '', 'http://localhost');
      const south = clampCoordinate(
        requestUrl.searchParams.get('south'),
        OVERPASS_HEALTH_DEFAULTS.south,
        -90,
        90,
      );
      const west = clampCoordinate(
        requestUrl.searchParams.get('west'),
        OVERPASS_HEALTH_DEFAULTS.west,
        -180,
        180,
      );
      const north = clampCoordinate(
        requestUrl.searchParams.get('north'),
        OVERPASS_HEALTH_DEFAULTS.north,
        -90,
        90,
      );
      const east = clampCoordinate(
        requestUrl.searchParams.get('east'),
        OVERPASS_HEALTH_DEFAULTS.east,
        -180,
        180,
      );
      const [safeSouth, safeNorth] =
        south <= north ? [south, north] : [north, south];
      const [safeWest, safeEast] = west <= east ? [west, east] : [east, west];
      const probe = requestUrl.searchParams.get('probe') === 'tiny'
        ? 'tiny'
        : 'security-points';
      const requestForm = requestUrl.searchParams.get('requestForm') === 'get-data'
        ? 'get-data'
        : null;
      const effectiveProbe = requestForm ? 'tiny' : probe;
      const box = {
        south: Number(formatSecurityPointViewportValue(safeSouth)),
        west: Number(formatSecurityPointViewportValue(safeWest)),
        north: Number(formatSecurityPointViewportValue(safeNorth)),
        east: Number(formatSecurityPointViewportValue(safeEast)),
      };
      const query =
        effectiveProbe === 'tiny'
          ? overpassTinyHealthQuery(box)
          : overpassHealthQuery(box);
      const body = encodeOverpassFormBody(query);
      const startedAt = Date.now();
      const responseBody = {
        probe: effectiveProbe,
        requestForm,
        reachable: false,
        method: requestForm === 'get-data' ? 'GET' : 'POST',
        endpoint: { hostname: null, path: null },
        httpStatus: null,
        latencyMs: null,
        timeoutTriggered: false,
        resultCount: 0,
        providerError: null,
        fallbackAttempted: false,
        finalSuccessfulEndpoint: null,
        attempts: [],
      };
      try {
        const payload =
          requestForm === 'get-data'
            ? await fetchOverpassGetDataProbe(body)
            : await fetchOverpassPayload(body);
        const latencyMs = Date.now() - startedAt;
        const attempts = summarizeOverpassAttempts(payload?.attempts);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify({
            ...responseBody,
            reachable: overpassPayloadIsData(payload),
            endpoint: overpassEndpointDetail(payload?.endpoint),
            httpStatus: Number(payload?.status) || null,
            latencyMs,
            timeoutTriggered: overpassTimeoutTriggered(null, payload),
            resultCount: overpassResultCount(payload),
            providerError: String(payload?.providerError || '').trim() || null,
            fallbackAttempted: payload?.fallbackAttempted === true,
            finalSuccessfulEndpoint: overpassPayloadIsData(payload)
              ? overpassEndpointDetail(payload?.finalEndpoint || payload?.endpoint)
              : null,
            attempts,
          }),
        );
      } catch (error) {
        const attempts = summarizeOverpassAttempts(error?.attempts);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        });
        res.end(
          JSON.stringify({
            ...responseBody,
            latencyMs: Date.now() - startedAt,
            timeoutTriggered: overpassTimeoutTriggered(error),
            providerError:
              String(error?.providerError || '').trim()
              || sanitizeOverpassError(error),
            fallbackAttempted: error?.fallbackAttempted === true,
            attempts,
            endpoint: attempts.at(-1)?.endpoint || responseBody.endpoint,
            httpStatus: attempts.at(-1)?.httpStatus ?? responseBody.httpStatus,
          }),
        );
      }
    });

    server.middlewares.use('/api/overpass', async (req, res) => {
      // Hoisted out of the try so the catch's serve-stale lookup can see it
      // (a body-read failure would otherwise hit an out-of-scope reference).
      let cacheKey = null;
      try {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Method Not Allowed' }));
          return;
        }

        // Collect POST body with a hard byte cap (Overpass QL queries are small)
        let body;
        try {
          body = (
            await readRequestBodyCapped(req, OVERPASS_MAX_BODY_BYTES)
          ).toString();
        } catch (err) {
          if (err?.code === 'BODY_TOO_LARGE') {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Overpass query too large' }));
            return;
          }
          throw err;
        }
        if (!body) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing Overpass query body' }));
          return;
        }

        // Validate + clamp the QL: reject unbounded/global queries and cap the
        // server-side timeout so a tiny body can't request planet-scale work.
        const sanitized = sanitizeOverpassBody(body);
        if (!sanitized.ok) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: sanitized.error }));
          return;
        }
        const safeBody = sanitized.body;

        // Normalize whitespace so semantically identical Overpass QL queries share cache entries
        cacheKey = safeBody.replace(/\s+/g, ' ').trim();
        const preflight = await resolveOverpassPreflight({
          cacheKey,
          memoryCache: _overpassCache,
          inFlight: _overpassInFlight,
          // Fresh-enough disk entries survive restarts and skip the public
          // mirrors; boundary-class queries keep their month-long TTL.
          readDisk: () =>
            readOverpassDisk(cacheKey, overpassDiskTtlMs(cacheKey)),
          allowUpstream: () => _overpassRateLimiter(clientKey(req)),
        });
        if (preflight.source === 'RATE_LIMITED') {
          res.writeHead(429, {
            'Content-Type': 'application/json',
            'Retry-After': '5',
          });
          res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
          return;
        }
        if (preflight.source !== 'UPSTREAM') {
          // A coalesced caller sees the same failure as the original request
          // and must get the same last-good fallback, not the raw refusal.
          if (!overpassPayloadIsData(preflight.payload)) {
            const stale = await readStaleOverpass(cacheKey);
            if (stale) {
              sendOverpassResponse(res, stale, 'STALE');
              return;
            }
          }
          if (preflight.source === 'DISK') {
            _overpassCache.set(cacheKey, preflight.payload);
            trimOverpassCache();
          }
          sendOverpassResponse(res, preflight.payload, preflight.source);
          return;
        }

        // From here onward the request is genuinely upstream-bound and has
        // consumed one local limiter slot. Cache and dedupe hits above do not.
        if (_overpassConcurrent >= OVERPASS_MAX_CONCURRENT) {
          res.writeHead(503, {
            'Content-Type': 'application/json',
            'Retry-After': '2',
          });
          res.end(
            JSON.stringify({
              error: 'Overpass proxy busy — try again shortly',
            }),
          );
          return;
        }
        _overpassConcurrent += 1;
        const requestPromise = fetchOverpassPayload(safeBody)
          .then((payload) => {
            // Only a 2xx is data. `< 500` cached every 4xx, so one mirror's
            // refusal was written to memory AND disk — and boundary-class
            // queries hold a month-long TTL, so a single 406 outlived the
            // outage that caused it.
            if (overpassPayloadIsData(payload)) {
              const entry = { ...payload, cachedAt: Date.now() };
              _overpassCache.set(cacheKey, entry);
              trimOverpassCache();
              writeOverpassDisk(cacheKey, entry);
            }
            return payload;
          })
          .finally(() => {
            _overpassConcurrent -= 1;
            _overpassInFlight.delete(cacheKey);
          });

        _overpassInFlight.set(cacheKey, requestPromise);
        const payload = await requestPromise;
        // Degraded upstream (rate-limited on every mirror / 5xx / runtime
        // error): last-good roads beat an empty layer — serve stale from
        // memory or disk at ANY age before surfacing the failure.
        if (!overpassPayloadIsData(payload)) {
          const stale = await readStaleOverpass(cacheKey);
          if (stale) {
            sendOverpassResponse(res, stale, 'STALE');
            return;
          }
        }
        sendOverpassResponse(res, payload, 'MISS');
      } catch (e) {
        // Every mirror threw (network-level). Same serve-stale rule.
        const stale = cacheKey ? await readStaleOverpass(cacheKey) : null;
        if (stale) {
          sendOverpassResponse(res, stale, 'STALE');
          return;
        }
        console.error('[Overpass Proxy]', e.message);
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Overpass proxy error' }));
      }
    });

    installRouteMiddleware(server.middlewares, routing);
  };
  return {
    name: 'overpass-proxy',
    configureServer: installMiddleware,
    configurePreviewServer: installMiddleware,
  };
}

export { overpassProxy };

export { isOverpassBoundaryQuery } from './overpass/query.js';
export { simplifyOverpassPayloadBody } from './overpass/geometry.js';
export { readOverpassDisk } from './overpass/cache.js';
export { resolveOverpassPreflight } from './overpass/cache.js';
export { overpassPayloadIsData } from './overpass/transport.js';
export { fetchOverpassPayload } from './overpass/transport.js';
