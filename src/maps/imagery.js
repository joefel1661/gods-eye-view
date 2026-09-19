import * as Cesium from 'cesium';
import { wrapProviderError } from './providerErrors.js';

// Attribution and service rights are documented in DATA_SOURCES.md.
export const ESRI_ATTRIBUTION_HTML =
  '<a href="https://www.esri.com" target="_blank" rel="noopener">Powered by Esri</a>';

export function createOsmImagery() {
  return new Cesium.OpenStreetMapImageryProvider({
    url: 'https://tile.openstreetmap.org/',
    credit: '© OpenStreetMap contributors',
  });
}

export function createEsriImagery() {
  return Cesium.ArcGisMapServerImageryProvider.fromUrl(
    'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer',
    {
      credit:
        'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      enablePickFeatures: false,
    },
  ).catch((error) => {
    throw wrapProviderError(
      error,
      'Esri Satellite request failed',
      'check provider availability or network access for the production origin',
    );
  });
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
