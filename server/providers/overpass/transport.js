import {
  OVERPASS_MAX_RESPONSE_BYTES,
  OVERPASS_UPSTREAMS,
  OVERPASS_USER_AGENT,
  OVERPASS_TIMEOUT_MS,
} from './constants.js';
import { readResponseTextCapped } from '../common/http.js';
import { simplifyOverpassPayloadBody } from './geometry.js';

/**
 * Detect whether an Overpass API response body indicates rate-limiting.
 *
 * Checks for known rate-limit phrases in the body text regardless of
 * HTTP status code, since some mirrors return 200 with an error payload.
 *
 * @param {string} bodyText - Upstream response body.
 * @returns {boolean} True if the body looks rate-limited.
 */
function overpassLooksRateLimited(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return (
    text.includes('rate_limited') ||
    text.includes('quota of your ip address') ||
    text.includes('dispatcher_client::request_read_and_idx::rate_limited') ||
    text.includes('too many requests')
  );
}

/**
 * Detect an Overpass HTTP-200 body that is actually a runtime FAILURE (server-side
 * timeout / out-of-memory) via its `remark`. These are transient upstream failures,
 * not authoritative empty results, so they must not be returned or cached.
 */
function overpassLooksRuntimeError(bodyText) {
  const text = String(bodyText || '').toLowerCase();
  return (
    text.includes('runtime error') ||
    text.includes('timed out') ||
    text.includes('out of memory')
  );
}

function sanitizeOverpassProviderText(bodyText, contentType = '') {
  const type = String(contentType || '').toLowerCase();
  const raw = String(bodyText || '');
  let text = '';
  let parsedJson = false;
  if (type.includes('json')) {
    try {
      parsedJson = true;
      const parsed = JSON.parse(raw);
      text =
        String(
          parsed?.remark
          || parsed?.error
          || parsed?.message
          || parsed?.remarks?.[0]
          || '',
        ).trim();
    } catch {
      /* fall through */
    }
  }
  if (parsedJson && !text) return null;
  if (!text) {
    text = raw
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim();
  }
  if (!text) text = raw.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 240) : null;
}

/**
 * True only for an upstream response that is actually Overpass data.
 *
 * The proxy caches on this and serves stale on its negation, so the two
 * decisions cannot drift apart: a payload that is not data must never be
 * written to the cache and must always be eligible for a stale replacement.
 * @param {{status: number, rateLimited?: boolean, runtimeError?: boolean}} payload
 * @returns {boolean}
 */
function overpassPayloadIsData(payload) {
  const status = Number(payload?.status);
  return (
    Number.isFinite(status) &&
    status >= 200 &&
    status < 300 &&
    !payload.rateLimited &&
    !payload.runtimeError
  );
}

/**
 * Try each mirror once, retaining response-size and per-mirror timeout caps.
 * Refusals and body-level failures rotate; total failure returns the last
 * rate-limit payload, otherwise the first refusal, or throws a network error.
 * @param {string} body URL-encoded Overpass QL query body.
 * @param {number} [maxResponseBytes] Endpoint-specific response cap.
 * @param {object} [options] Server-only endpoint and I/O overrides for tests.
 * @returns {Promise<{status:number,body:string,contentType:string,endpoint:string,rateLimited:boolean}>}
 */
async function fetchOverpassPayload(
  body,
  maxResponseBytes = OVERPASS_MAX_RESPONSE_BYTES,
  {
    endpoints = OVERPASS_UPSTREAMS,
    fetchImpl = fetch,
    readBody = readResponseTextCapped,
    simplify = simplifyOverpassPayloadBody,
  } = {},
) {
  let lastError = null;
  let lastRateLimitPayload = null;
  let lastRefusalPayload = null;
  const attempts = [];

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OVERPASS_TIMEOUT_MS);
    const startedAt = Date.now();

    try {
      const upstream = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'User-Agent': OVERPASS_USER_AGENT,
        },
        body,
        signal: controller.signal,
      });

      const responseBody = await readBody(upstream, maxResponseBytes);
      const contentType =
        upstream.headers.get('content-type') || 'application/json';
      const status = upstream.status;
      const rateLimited =
        status === 429 || overpassLooksRateLimited(responseBody);
      const runtimeError = overpassLooksRuntimeError(responseBody);
      const providerError = sanitizeOverpassProviderText(
        responseBody,
        contentType,
      );
      const payload = {
        status,
        body: responseBody,
        contentType,
        endpoint,
        rateLimited,
        runtimeError,
        providerError,
      };
      attempts.push({
        endpoint,
        method: 'POST',
        status,
        latencyMs: Date.now() - startedAt,
        timeoutTriggered: status === 504 || runtimeError,
        providerError,
      });

      if (rateLimited) {
        lastRateLimitPayload = payload;
        continue;
      }
      // A 200 body carrying a runtime error / timeout is a transient upstream
      // failure — skip to the next mirror rather than returning or caching it.
      if (runtimeError) {
        lastError = new Error(`Overpass runtime error (${endpoint})`);
        continue;
      }
      // Anything but 2xx is this mirror declining, not an answer. Only 5xx used
      // to rotate, so a 4xx ended the fan-out and was returned — and cached —
      // as data: a mirror refusing this client answers 406 while the others
      // answer 200 to the very same request, so every Overpass-backed layer
      // failed on an error page with healthy mirrors untried. The first
      // refusal is kept so a genuinely bad query still reports what upstream
      // said, but only after every mirror has had the chance to answer it.
      if (status < 200 || status >= 300) {
        if (!lastRefusalPayload) lastRefusalPayload = payload;
        lastError = new Error(
          `Overpass upstream returned ${status} (${endpoint})`,
        );
        continue;
      }

      // Success: decimate giant boundary geometry before it reaches the cache,
      // the disk, or the client (what makes the 32 MB read cap safe to hold).
      payload.body = simplify(payload.body);
      return {
        ...payload,
        attempts,
        fallbackAttempted: attempts.length > 1,
        finalEndpoint: endpoint,
      };
    } catch (error) {
      lastError = error;
      attempts.push({
        endpoint,
        method: 'POST',
        status: null,
        latencyMs: Date.now() - startedAt,
        timeoutTriggered:
          error?.name === 'AbortError' || error?.name === 'TimeoutError',
        providerError: String(error?.message || '').trim().slice(0, 240) || null,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  if (lastRateLimitPayload) {
    return {
      ...lastRateLimitPayload,
      attempts,
      fallbackAttempted: attempts.length > 1,
      finalEndpoint: null,
    };
  }
  if (lastRefusalPayload) {
    return {
      ...lastRefusalPayload,
      attempts,
      fallbackAttempted: attempts.length > 1,
      finalEndpoint: null,
    };
  }
  throw Object.assign(lastError || new Error('All Overpass upstreams failed'), {
    attempts,
    fallbackAttempted: attempts.length > 1,
    providerError: attempts.at(-1)?.providerError || null,
  });
}

export {
  overpassPayloadIsData,
  fetchOverpassPayload,
  sanitizeOverpassProviderText,
};
