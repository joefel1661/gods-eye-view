import * as Cesium from 'cesium';

export const MAP_STACKS = [
  {
    id: 'photoreal',
    label: 'Google Satellite / 3D',
    shortLabel: '3D',
    kind: 'photoreal',
    requiresIon: false,
  },
  {
    id: 'road',
    label: 'Road Map',
    shortLabel: 'ROAD',
    kind: 'road',
    requiresIon: false,
  },
  {
    id: 'hybrid',
    label: 'Hybrid',
    shortLabel: 'HYB',
    kind: 'hybrid',
    requiresIon: false,
  },
  {
    id: 'terrain',
    label: 'Terrain',
    shortLabel: 'TER',
    kind: 'terrain',
    requiresIon: false,
  },
  {
    id: 'osm',
    label: 'OSM',
    shortLabel: 'OSM',
    kind: 'osm',
    requiresIon: false,
  },
  {
    id: 'esri-imagery',
    label: 'Esri Satellite',
    shortLabel: 'SAT',
    kind: 'esri-imagery',
    requiresIon: false,
  },
  {
    id: 'bing-aerial',
    label: 'Bing Aerial',
    shortLabel: 'Aerial',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL,
    requiresIon: true,
  },
  {
    id: 'bing-labels',
    label: 'Bing Labels',
    shortLabel: 'Labels',
    kind: 'ion',
    style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS,
    requiresIon: true,
  },
];
