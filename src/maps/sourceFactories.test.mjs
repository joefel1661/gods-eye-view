import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cesium from 'cesium';
import { createIonImagery } from './imagery.js';
import {
  createWorldTerrain,
  createKeylessTerrain,
  createFallbackEllipsoidTerrain,
} from './terrain.js';
import { createDefaultMapSources } from './defaultSources.js';

test('default sources keep road flat and reserve relief terrain for terrain mode', async () => {
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const originalResource = Cesium.IonResource.fromAssetId;
  const calls = [];
  try {
    Cesium.CesiumTerrainProvider.fromUrl = async (resource) => {
      calls.push(resource);
      return { resource };
    };
    Cesium.IonResource.fromAssetId = async () =>
      assert.fail('keyless mode must not acquire ion terrain');
    const keyless = createDefaultMapSources();
    const road = keyless.sources.find(
      ({ descriptor }) => descriptor.id === 'road',
    );
    const terrain = keyless.sources.find(
      ({ descriptor }) => descriptor.id === 'terrain',
    );
    assert.equal(road.available, true);
    assert.equal(road.terrain.id, 'ellipsoid');
    assert.equal(terrain.terrain.id, 'keyless');
    assert.equal(terrain.terrain.create, createKeylessTerrain);
    await terrain.terrain.create();
    assert.deepEqual(calls, [
      'https://terrain.reearth.land/cesium-mesh/ellipsoid',
    ]);
    assert.equal(
      keyless.sources.find(({ descriptor }) => descriptor.id === 'photoreal')
        .available,
      false,
    );
    for (const credentials of [
      { googleApiKey: 'test-key' },
      { cesiumToken: 'test-token' },
    ]) {
      const keyed = createDefaultMapSources({
        ...credentials,
        googleTileset: { show: true },
      });
      assert.equal(
        keyed.sources.find(({ descriptor }) => descriptor.id === 'photoreal')
          .available,
        true,
      );
      assert.equal(
        keyed.sources.find(({ descriptor }) => descriptor.id === 'terrain')
          .terrain.id,
        credentials.cesiumToken ? 'world' : 'keyless',
      );
      const failedTileset = createDefaultMapSources(credentials);
      assert.equal(
        failedTileset.sources.find(
          ({ descriptor }) => descriptor.id === 'photoreal',
        ).available,
        false,
      );
    }
  } finally {
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
    Cesium.IonResource.fromAssetId = originalResource;
  }
});

test('imagery and terrain pass their own ion token without relying on SDK defaults', async () => {
  const originalImagery = Cesium.IonImageryProvider.fromAssetId;
  const originalResource = Cesium.IonResource.fromAssetId;
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const calls = [];
  const defaultToken = Cesium.Ion.defaultAccessToken;
  try {
    Cesium.IonImageryProvider.fromAssetId = async (id, options) => {
      calls.push({ kind: 'imagery', id, options });
      return { id };
    };
    Cesium.IonResource.fromAssetId = async (id, options) => {
      calls.push({ kind: 'resource', id, options });
      return { id };
    };
    Cesium.CesiumTerrainProvider.fromUrl = async (resource, options) => {
      calls.push({ kind: 'terrain', resource, options });
      return { id: 'terrain' };
    };
    await createIonImagery(Cesium.IonWorldImageryStyle.AERIAL, 'imagery-token');
    const result = await createWorldTerrain('terrain-token');
    assert.equal(calls[0].options.accessToken, 'imagery-token');
    assert.equal(calls[1].options.accessToken, 'terrain-token');
    assert.equal(calls[1].id, 1);
    assert.equal(calls[2].options.requestVertexNormals, true);
    assert.equal(result.provider.id, 'terrain');
    assert.equal(Cesium.Ion.defaultAccessToken, defaultToken);
  } finally {
    Cesium.IonImageryProvider.fromAssetId = originalImagery;
    Cesium.IonResource.fromAssetId = originalResource;
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
  }
});

test('cancellation after ion metadata prevents terrain construction', async () => {
  const originalResource = Cesium.IonResource.fromAssetId;
  const originalTerrain = Cesium.CesiumTerrainProvider.fromUrl;
  const controller = new AbortController();
  try {
    Cesium.IonResource.fromAssetId = async () => {
      controller.abort();
      return {};
    };
    Cesium.CesiumTerrainProvider.fromUrl = () =>
      assert.fail('cancelled terrain construction');
    await assert.rejects(
      createWorldTerrain('test-token', { signal: controller.signal }),
      { name: 'AbortError' },
    );
  } finally {
    Cesium.IonResource.fromAssetId = originalResource;
    Cesium.CesiumTerrainProvider.fromUrl = originalTerrain;
  }
});

test('credentialed source factories reject an omitted token instead of consuming an SDK default', async () => {
  assert.throws(
    () => createIonImagery(Cesium.IonWorldImageryStyle.AERIAL, ''),
    /explicit token/,
  );
  await assert.rejects(createWorldTerrain(' '), /explicit ion token/);
});

test('ion imagery and terrain failures surface provider-specific 403 guidance', async () => {
  const originalImagery = Cesium.IonImageryProvider.fromAssetId;
  const originalResource = Cesium.IonResource.fromAssetId;
  try {
    Cesium.IonImageryProvider.fromAssetId = async () => {
      throw new Error('Request has failed. Status Code: 403');
    };
    Cesium.IonResource.fromAssetId = async () => {
      throw new Error('Request has failed. Status Code: 403');
    };
    await assert.rejects(
      createIonImagery(Cesium.IonWorldImageryStyle.AERIAL, 'token'),
      /Cesium ion imagery was denied \(HTTP 403\)/,
    );
    await assert.rejects(
      createWorldTerrain('token'),
      /Cesium ion terrain metadata was denied \(HTTP 403\)/,
    );
  } finally {
    Cesium.IonImageryProvider.fromAssetId = originalImagery;
    Cesium.IonResource.fromAssetId = originalResource;
  }
});

test('terrain source exposes optional flat fallback contract', async () => {
  const registry = createDefaultMapSources({ cesiumToken: 'token' });
  const terrain = registry.sources.find(
    ({ descriptor }) => descriptor.id === 'terrain',
  ).terrain;
  assert.equal(terrain.optional, true);
  assert.equal(terrain.fallback, createFallbackEllipsoidTerrain);
  const fallback = await terrain.fallback({ statusCode: 403 });
  assert.equal(fallback.terrainId, 'ellipsoid');
  assert.match(fallback.warning, /using flat globe/);
});
