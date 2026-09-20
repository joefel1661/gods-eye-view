import { MAP_STACKS } from './catalog.js';
import { photorealUnavailableReason } from './availability.js';
import { keySetupRequirement } from '../keySetupCore.mjs';
import {
  createOsmImagery,
  createEsriImagery,
  createRoadImagery,
  createTerrainImagery,
  createIonImagery,
  ESRI_ATTRIBUTION_HTML,
} from './imagery.js';
import {
  createWorldTerrain,
  createKeylessTerrain,
  createEllipsoidTerrain,
  createFallbackEllipsoidTerrain,
} from './terrain.js';

/** Select sources and setup guidance without putting provider branches in the controller. */
export function createDefaultMapSources({
  googleTileset = null,
  cesiumToken = '',
  googleApiKey = '',
} = {}) {
  const ionToken = String(cesiumToken || '').trim();
  const hasIon = Boolean(ionToken);
  const hasGoogle = Boolean(String(googleApiKey || '').trim());
  const reliefTerrain = {
    id: hasIon ? 'world' : 'keyless',
    create: hasIon
      ? (request) => createWorldTerrain(ionToken, request)
      : createKeylessTerrain,
    optional: true,
    fallback: createFallbackEllipsoidTerrain,
  };
  const flatTerrain = {
    id: 'ellipsoid',
    create: createEllipsoidTerrain,
  };
  return {
    defaultId: googleTileset ? 'photoreal' : 'road',
    unknownId: 'photoreal',
    recoveryId: googleTileset ? 'photoreal' : null,
    state: { hasCesiumIonToken: hasIon },
    sources: MAP_STACKS.map((descriptor) => {
      const common = {
        descriptor,
        available: !descriptor.requiresIon || hasIon,
        unavailableReason: descriptor.requiresIon
          ? keySetupRequirement('cesium-ion')
          : null,
      };
      if (descriptor.kind === 'photoreal')
        return {
          ...common,
          available: Boolean(googleTileset),
          unavailableReason: photorealUnavailableReason(hasIon || hasGoogle),
          tileset: googleTileset,
        };
      const imagery =
        descriptor.kind === 'ion'
          ? () => createIonImagery(descriptor.style, ionToken)
          : descriptor.kind === 'road'
            ? createRoadImagery
            : descriptor.kind === 'terrain'
              ? createTerrainImagery
              : descriptor.id === 'osm'
                ? createOsmImagery
                : createEsriImagery;
      return {
        ...common,
        imagery,
        terrain: descriptor.kind === 'terrain' ? reliefTerrain : flatTerrain,
        ...(['hybrid', 'terrain', 'esri-imagery'].includes(descriptor.id)
          ? {
              credit: ESRI_ATTRIBUTION_HTML,
              constructionFallback: {
                id: 'osm',
                message:
                  descriptor.id === 'hybrid'
                    ? 'Hybrid map is unavailable; using OSM'
                    : descriptor.id === 'terrain'
                      ? 'Terrain map is unavailable; using OSM'
                      : 'Esri Satellite is unavailable; using OSM',
              },
              tileFailureFallback: {
                id: 'osm',
                threshold: 2,
                message:
                  descriptor.id === 'hybrid'
                    ? 'Hybrid map tile requests failed; using OSM'
                    : descriptor.id === 'terrain'
                      ? 'Terrain map tile requests failed; using OSM'
                      : 'Esri Satellite tile requests failed; using OSM',
              },
            }
          : {}),
      };
    }),
  };
}
