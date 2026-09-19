import test from 'node:test';
import assert from 'node:assert/strict';
import { overpassProxy } from '../../server/providers/overpass.js';

function install(register) {
  const routes = new Map();
  register({
    use(route, handler) {
      routes.set(route, handler);
    },
  });
  return async (route, url = '', method = 'GET') => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name.toLowerCase()] = value;
      },
      writeHead(status, headers) {
        this.statusCode = status;
        for (const [key, value] of Object.entries(headers))
          this.setHeader(key, value);
      },
      end(body) {
        this.body = JSON.parse(body);
      },
    };
    await routes.get(route)(
      { url, method, socket: { remoteAddress: 'fixture' } },
      res,
    );
    return res;
  };
}

test('Overpass health reports probe metadata without exposing sensitive data', async (t) => {
  const plugin = overpassProxy();
  const request = install((middlewares) =>
    plugin.configureServer({
      middlewares,
    }),
  );
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://overpass-api.de/api/interpreter');
    assert.equal(options.method, 'POST');
   const query = new URLSearchParams(String(options.body || '')).get('data');
   assert.match(String(query), /amenity"="police"/);
   assert.match(String(query), /emergency"="emergency_department"/);
   assert.match(String(query), /aeroway"="heliport"/);
   return Response.json(
     { elements: [{ type: 'node', id: 1 }] },
     { status: 200 },
   );
  });
  const result = await request('/api/overpass/health');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.reachable, true);
  assert.equal(result.body.method, 'POST');
  assert.equal(result.body.httpStatus, 200);
  assert.equal(result.body.timeoutTriggered, false);
  assert.equal(result.body.resultCount, 1);
  assert.equal(result.body.fallbackAttempted, false);
  assert.equal(result.body.providerError, null);
  assert.deepEqual(result.body.endpoint, {
    hostname: 'overpass-api.de',
    path: '/api/interpreter',
  });
  assert.deepEqual(result.body.finalSuccessfulEndpoint, result.body.endpoint);
  assert.equal(result.body.attempts.length, 1);
  assert.ok(Number.isFinite(result.body.latencyMs));
});

test('Overpass health flags timeout failures', async (t) => {
  const plugin = overpassProxy();
  const request = install((middlewares) =>
    plugin.configureServer({
      middlewares,
    }),
  );
  t.mock.method(globalThis, 'fetch', async () => {
    throw new DOMException('signal timed out', 'AbortError');
  });
  const result = await request('/api/overpass/health');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.reachable, false);
  assert.equal(result.body.httpStatus, null);
  assert.equal(result.body.timeoutTriggered, true);
  assert.equal(result.body.resultCount, 0);
  assert.match(String(result.body.providerError), /timed out/i);
  assert.equal(result.body.fallbackAttempted, true);
  assert.equal(result.body.attempts.length, 4);
});

test('Overpass health reports fallback attempts and sanitized 406 refusals', async (t) => {
  const plugin = overpassProxy();
  const request = install((middlewares) =>
    plugin.configureServer({
      middlewares,
    }),
  );
  const refusal = `<!DOCTYPE HTML><html><head><title>406 Not Acceptable</title></head><body><h1>Not Acceptable</h1><p>An appropriate representation of the requested resource could not be found on this server.</p></body></html>`;
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url) === 'https://overpass-api.de/api/interpreter')
      return new Response(refusal, {
        status: 406,
        headers: { 'content-type': 'text/html' },
      });
    if (String(url) === 'https://overpass.kumi.systems/api/interpreter')
      return Response.json({ elements: [{ type: 'node', id: 2 }] }, { status: 200 });
    throw new Error(`unexpected url: ${url}`);
  });
  const result = await request(
    '/api/overpass/health',
    '/api/overpass/health?probe=tiny',
  );
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.reachable, true);
  assert.equal(result.body.fallbackAttempted, true);
  assert.deepEqual(result.body.finalSuccessfulEndpoint, {
    hostname: 'overpass.kumi.systems',
    path: '/api/interpreter',
  });
  assert.equal(result.body.attempts.length, 2);
  assert.match(
    String(result.body.attempts[0].providerError),
    /appropriate representation/i,
  );
});
