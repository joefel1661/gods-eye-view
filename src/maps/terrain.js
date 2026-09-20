import * as Cesium from 'cesium';
import { wrapProviderError } from './providerErrors.js';

/** These factories are lazy: a hidden globe must not trigger terrain loading. */
export async function createWorldTerrain(accessToken, { signal } = {}) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken)
    throw new Error('World terrain requires an explicit ion token');
  signal?.throwIfAborted();
  const resource = await Cesium.IonResource.fromAssetId(1, {
    accessToken,
  }).catch((error) => {
    throw wrapProviderError(
      error,
      'Cesium ion terrain metadata was denied',
      'check CESIUM_ION_TOKEN URL restrictions, asset access, and quota for the production origin',
    );
  });
  signal?.throwIfAborted();
  return {
    provider: await Cesium.CesiumTerrainProvider.fromUrl(resource, {
      requestVertexNormals: true,
      requestWaterMask: false,
      ellipsoid: Cesium.Ellipsoid.WGS84,
    }).catch((error) => {
      throw wrapProviderError(
        error,
        'Cesium ion terrain request failed',
        'check CESIUM_ION_TOKEN asset access and provider availability for the production origin',
      );
    }),
  };
}

export async function createKeylessTerrain() {
  try {
    // Re:Earth / Mapterhorn ellipsoidal quantized mesh, CC BY 4.0.
    return {
      provider: await Cesium.CesiumTerrainProvider.fromUrl(
        'https://terrain.reearth.land/cesium-mesh/ellipsoid',
      ),
    };
  } catch (error) {
    console.warn(
      '[MapStack] Re:Earth terrain unavailable, falling back to flat ellipsoid terrain:',
      error,
    );
    return { provider: new Cesium.EllipsoidTerrainProvider() };
  }
}

export function createEllipsoidTerrain() {
  return { provider: new Cesium.EllipsoidTerrainProvider() };
}

export async function createFallbackEllipsoidTerrain(error) {
  const status = Number(error?.statusCode);
  const detail =
    Number.isFinite(status) && status > 0 ? `HTTP ${status}` : 'unavailable';
  return {
    ...createEllipsoidTerrain(),
    terrainId: 'ellipsoid',
    warning: `Optional terrain ${detail}; using flat globe`,
  };
}
