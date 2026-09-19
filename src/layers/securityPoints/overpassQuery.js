import { CATEGORY_ORDER, QUERY_LIMIT } from './policy.js';

export function formatSecurityPointViewportValue(value) {
  return Number(value).toFixed(5);
}

export function buildSecurityPointsOverpassQuery(
  box,
  enabledCategories = CATEGORY_ORDER,
  { queryLimit = QUERY_LIMIT, timeoutSec = 25 } = {},
) {
  const bbox = `(${formatSecurityPointViewportValue(box.south)},${formatSecurityPointViewportValue(box.west)},${formatSecurityPointViewportValue(box.north)},${formatSecurityPointViewportValue(box.east)})`;
  const clauses = [];
  if (enabledCategories.includes('police')) {
    clauses.push(`node["amenity"="police"]${bbox};`);
    clauses.push(`way["amenity"="police"]${bbox};`);
    clauses.push(`relation["amenity"="police"]${bbox};`);
    clauses.push(`node["office"="government"]["name"~"sheriff",i]${bbox};`);
    clauses.push(`way["office"="government"]["name"~"sheriff",i]${bbox};`);
    clauses.push(`relation["office"="government"]["name"~"sheriff",i]${bbox};`);
    clauses.push(`node["law_enforcement"="sheriff"]${bbox};`);
    clauses.push(`way["law_enforcement"="sheriff"]${bbox};`);
    clauses.push(`relation["law_enforcement"="sheriff"]${bbox};`);
  }
  if (enabledCategories.includes('fireEms')) {
    clauses.push(`node["amenity"="fire_station"]${bbox};`);
    clauses.push(`way["amenity"="fire_station"]${bbox};`);
    clauses.push(`relation["amenity"="fire_station"]${bbox};`);
    clauses.push(`node["emergency"="fire_station"]${bbox};`);
    clauses.push(`way["emergency"="fire_station"]${bbox};`);
    clauses.push(`relation["emergency"="fire_station"]${bbox};`);
    clauses.push(`node["amenity"="ambulance_station"]${bbox};`);
    clauses.push(`way["amenity"="ambulance_station"]${bbox};`);
    clauses.push(`relation["amenity"="ambulance_station"]${bbox};`);
    clauses.push(`node["emergency"="ambulance_station"]${bbox};`);
    clauses.push(`way["emergency"="ambulance_station"]${bbox};`);
    clauses.push(`relation["emergency"="ambulance_station"]${bbox};`);
  }
  if (enabledCategories.includes('hospitals')) {
    clauses.push(`node["amenity"="hospital"]${bbox};`);
    clauses.push(`way["amenity"="hospital"]${bbox};`);
    clauses.push(`relation["amenity"="hospital"]${bbox};`);
    clauses.push(`node["healthcare"="hospital"]${bbox};`);
    clauses.push(`way["healthcare"="hospital"]${bbox};`);
    clauses.push(`relation["healthcare"="hospital"]${bbox};`);
    clauses.push(`node["emergency"="emergency_ward"]${bbox};`);
    clauses.push(`way["emergency"="emergency_ward"]${bbox};`);
    clauses.push(`relation["emergency"="emergency_ward"]${bbox};`);
    clauses.push(`node["emergency"="emergency_department"]${bbox};`);
    clauses.push(`way["emergency"="emergency_department"]${bbox};`);
    clauses.push(`relation["emergency"="emergency_department"]${bbox};`);
  }
  if (enabledCategories.includes('airports')) {
    clauses.push(`node["aeroway"="airport"]${bbox};`);
    clauses.push(`way["aeroway"="airport"]${bbox};`);
    clauses.push(`relation["aeroway"="airport"]${bbox};`);
    clauses.push(`node["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`way["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`relation["aeroway"="aerodrome"]${bbox};`);
    clauses.push(`node["aeroway"="heliport"]${bbox};`);
    clauses.push(`way["aeroway"="heliport"]${bbox};`);
    clauses.push(`relation["aeroway"="heliport"]${bbox};`);
  }
  return `[out:json][timeout:${Number(timeoutSec)}];(\n${clauses.join('\n')}\n);out tags center ${Number(queryLimit)};`;
}

