import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import connect from 'connect';
import { localProviderPlugins } from '../../server/providers/local.js';

test('standalone Node server exposes Google health through the production middleware stack', async (t) => {
  const before = {
    server: process.env.GOOGLE_MAPS_SERVER_API_KEY,
    browser: process.env.GOOGLE_MAPS_API_KEY,
  };
  process.env.GOOGLE_MAPS_SERVER_API_KEY = 'fixture-server-key';
  delete process.env.GOOGLE_MAPS_API_KEY;
  t.after(() => {
    for (const [name, value] of Object.entries({
      GOOGLE_MAPS_SERVER_API_KEY: before.server,
      GOOGLE_MAPS_API_KEY: before.browser,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const app = connect();
  const providerServer = { middlewares: app };
  for (const plugin of localProviderPlugins()) {
    if (typeof plugin.configureServer === 'function') {
      plugin.configureServer(providerServer);
    }
  }
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const nativeFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (raw, options) => {
    const url = new URL(raw);
    if (url.hostname === '127.0.0.1') return nativeFetch(raw, options);
    assert.equal(url.hostname, 'places.googleapis.com');
    assert.equal(url.pathname, '/v1/places:searchNearby');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Goog-Api-Key'], 'fixture-server-key');
    return Response.json({ places: [] }, { status: 200 });
  });

  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/api/google/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.serverKeyConfigured, true);
  assert.equal(body.keyMode, 'server-key');
  assert.equal(body.reachable, true);
  assert.equal(body.httpStatus, 200);
  assert.equal(body.timeoutTriggered, false);
  assert.doesNotMatch(JSON.stringify(body), /fixture-server-key/);
});
