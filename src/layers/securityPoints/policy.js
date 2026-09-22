export const LAYER_ID = 'security-points';
export const OVERPASS_URL = '/api/overpass';
export const GOOGLE_NEARBY_URL = '/api/google/nearby-places';
export const GOOGLE_PLACE_DETAILS_URL = '/api/google/place-details';
export const GOOGLE_TEXT_SEARCH_URL = '/api/google/text-search';
export const REQUEST_DEBOUNCE_MS = 500;
export const MAX_VIEWPORT_DEGREES = 1.8;
export const QUERY_LIMIT = 250;
export const GOOGLE_QUERY_LIMIT = 20;
export const VIEWPORT_REQUEST_TIMEOUT_MS = 30000;
export const DETAIL_REQUEST_TIMEOUT_MS = 5000;

export const CATEGORY_ORDER = Object.freeze([
  'police',
  'fireEms',
  'hospitals',
  'urgentCare',
  'airports',
  'pharmacies',
]);

export const CATEGORY_CONFIG = Object.freeze({
  police: Object.freeze({
    id: 'police',
    label: 'Police',
    cardLabel: 'Police / Sheriff',
    icon: '🚓',
    color: '#3b82f6',
    googleTypes: ['police'],
    markerSize: 9,
  }),
  fireEms: Object.freeze({
    id: 'fireEms',
    label: 'Fire / EMS',
    cardLabel: 'Fire / EMS',
    icon: '🚒',
    color: '#ef4444',
    googleTypes: ['fire_station', 'ambulance_service'],
    markerSize: 9,
  }),
  hospitals: Object.freeze({
    id: 'hospitals',
    label: 'Hospitals',
    cardLabel: 'Hospitals / Emergency Departments',
    icon: '🏥',
    color: '#eab308',
    googleTypes: ['hospital', 'emergency_room'],
    markerSize: 9,
  }),
  urgentCare: Object.freeze({
    id: 'urgentCare',
    label: 'Urgent Care',
    cardLabel: 'Urgent Care',
    icon: '🩺',
    color: '#14b8a6',
    googleTextQuery: 'urgent care',
    markerSize: 9,
  }),
  airports: Object.freeze({
    id: 'airports',
    label: 'Airports',
    cardLabel: 'Airports / Heliports',
    icon: '🛫',
    color: '#a855f7',
    googleTypes: ['airport', 'heliport'],
    markerSize: 10,
  }),
  pharmacies: Object.freeze({
    id: 'pharmacies',
    label: 'Pharmacies',
    cardLabel: 'Pharmacies',
    icon: '💊',
    color: '#22c55e',
    googleTypes: ['pharmacy'],
    markerSize: 9,
  }),
});

export const DEFAULT_CATEGORY_PARAMS = Object.freeze({
  police: true,
  fireEms: true,
  hospitals: true,
  urgentCare: true,
  airports: true,
  pharmacies: true,
});
