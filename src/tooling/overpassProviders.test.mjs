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
    return Response.json(
      { elements: [{ type: 'node', id: 1 }] },
      { status: 200 },
    );
  });
  const result = await request('/api/overpass/health');
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.reachable, true);
  assert.equal(result.body.httpStatus, 200);
  assert.equal(result.body.timeoutTriggered, false);
  assert.equal(result.body.resultCount, 1);
  assert.deepEqual(result.body.endpoint, {
    hostname: 'overpass-api.de',
    path: '/api/interpreter',
  });
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
  assert.match(String(result.body.error), /timed out/i);
});
