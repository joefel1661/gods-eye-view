import * as Cesium from 'cesium';
import { wrapProviderError } from './providerErrors.js';

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';

function createArcGisImagery(url, summary) {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(url, {
    credit:
      'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    enablePickFeatures: false,
  }).catch((error) => {
    throw wrapProviderError(
      error,
      summary,
      'check provider availability or network access for the production origin',
    );
  });
}

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return createArcGisImagery(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    'Satellite map request failed',
  );
}

export function createRoadImagery() {
  return createArcGisImagery(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer',
    'Road map request failed',
  );
}

export function createTerrainImagery() {
  return createArcGisImagery(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer',
    'Terrain map request failed',
  );
}

export function createIonImagery(style, accessToken) {
  accessToken = String(accessToken || '').trim();
  if (!accessToken) throw new Error('Ion imagery requires an explicit token');
  return Cesium.IonImageryProvider.fromAssetId(style, { accessToken }).catch(
    (error) => {
      throw wrapProviderError(
        error,
        'Cesium ion imagery was denied',
        'check CESIUM_ION_TOKEN URL restrictions, asset access, and quota for the production origin',
      );
    },
  );
}
