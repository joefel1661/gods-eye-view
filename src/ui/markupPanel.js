import * as Cesium from 'cesium';
import { pickWorldFromScreen } from '../annotations/annotationResolver.js';
import { MOBILE_LAYOUT_MEDIA_QUERY } from './layoutBreakpoints.js';
import {
  claimPointer,
  pointerOwner,
  releasePointer,
} from '../data/inputOwnership.js';

const MARKUP_POINTER_OWNER = 'markup-edit';
const DB_NAME = 'gev-markups-v1';
const STORE_NAME = 'markups';
const IMPORT_FORMAT = 'gev-markup';
const IMPORT_VERSION = 1;
const DEFAULT_CATEGORIES = Object.freeze([
  'Principal',
  'Residence',
  'Hotel',
  'Entrance',
  'Exit',
  'Vehicle',
  'Vehicle Staging',
  'Agent Post',
  'Rally Point',
  'Medical',
  'Police',
  'Fire',
  'Airport',
  'Hazard',
  'Concern',
  'Other',
]);
const ROUTE_TYPE_OPTIONS = Object.freeze([
  'Route',
  'Primary Route',
  'Alternate Route',
  'Emergency Route',
  'Evacuation Route',
  'Foot Route',
  'Vehicle Route',
  'Patrol Route',
  'Other',
]);
const DRAWING_TOOLS = new Set(['marker', 'line', 'polygon', 'circle']);
const DRAWING_LABELS = Object.freeze({
  marker: 'MARKER',
  line: 'ROUTE',
  polygon: 'AREA',
  circle: 'RADIUS',
  delete: 'DELETE',
});

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return (
    globalThis.crypto?.randomUUID?.() ||
    `markup-${Date.now()}-${Math.random().toString(16).slice(2)}`
  );
}

function sanitizeText(value) {
  return String(value || '').trim();
}

function coordFromWorld(world) {
  if (!world) return null;
  return {
    lon: world.lon,
    lat: world.lat,
    height: Number.isFinite(world.height) ? world.height : 0,
  };
}

function distanceMeters(a, b) {
  const geodesic = new Cesium.EllipsoidGeodesic(
    Cesium.Cartographic.fromDegrees(a.lon, a.lat),
    Cesium.Cartographic.fromDegrees(b.lon, b.lat),
  );
  return geodesic.surfaceDistance || 0;
}

function normalizeCategory(input, options = DEFAULT_CATEGORIES) {
  const category = sanitizeText(input);
  if (!category)
    return options.includes('Other') ? 'Other' : options[0] || 'Other';
  const known = options.find(
    (entry) => entry.toLowerCase() === category.toLowerCase(),
  );
  return known || category;
}

function isValidCoordinate(value) {
  return (
    value &&
    Number.isFinite(value.lon) &&
    Number.isFinite(value.lat) &&
    Math.abs(value.lon) <= 180 &&
    Math.abs(value.lat) <= 90
  );
}

function validateMarkupObject(object) {
  if (!object || typeof object !== 'object') return false;
  if (!['marker', 'line', 'polygon', 'circle'].includes(object.type))
    return false;
  if (!sanitizeText(object.id)) return false;
  if (!sanitizeText(object.createdAt) || !sanitizeText(object.updatedAt))
    return false;
  if (object.type === 'marker') {
    return isValidCoordinate(object.geometry?.position);
  }
  if (object.type === 'line' || object.type === 'polygon') {
    const points = object.geometry?.points;
    if (!Array.isArray(points)) return false;
    const minimum = object.type === 'line' ? 2 : 3;
    return points.length >= minimum && points.every(isValidCoordinate);
  }
  if (object.type === 'circle') {
    return (
      isValidCoordinate(object.geometry?.center) &&
      Number.isFinite(object.geometry?.radiusMeters) &&
      object.geometry.radiusMeters > 0
    );
  }
  return false;
}

function validateMarkup(markup) {
  if (!markup || typeof markup !== 'object') return false;
  if (!sanitizeText(markup.id) || !sanitizeText(markup.name)) return false;
  if (!sanitizeText(markup.createdAt) || !sanitizeText(markup.updatedAt))
    return false;
  if (!Array.isArray(markup.objects)) return false;
  return markup.objects.every(validateMarkupObject);
}

function ensureMarkupObject(raw) {
  const timestamp = nowIso();
  const type = raw?.type;
  const categoryOptions =
    type === 'line' ? ROUTE_TYPE_OPTIONS : DEFAULT_CATEGORIES;
  const object = {
    id: sanitizeText(raw?.id) || uuid(),
    type,
    visible: raw?.visible !== false,
    category: normalizeCategory(raw?.category, categoryOptions),
    title: sanitizeText(raw?.title),
    description: sanitizeText(raw?.description),
    notes: sanitizeText(raw?.notes),
    geometry: raw?.geometry,
    createdAt: sanitizeText(raw?.createdAt) || timestamp,
    updatedAt: sanitizeText(raw?.updatedAt) || timestamp,
  };
  if (!validateMarkupObject(object)) return null;
  return object;
}

function normalizeMarkup(raw) {
  const timestamp = nowIso();
  const objects = Array.isArray(raw?.objects)
    ? raw.objects.map(ensureMarkupObject).filter(Boolean)
    : [];
  return {
    id: sanitizeText(raw?.id) || uuid(),
    name: sanitizeText(raw?.name) || 'Untitled Markup',
    description: sanitizeText(raw?.description),
    createdAt: sanitizeText(raw?.createdAt) || timestamp,
    updatedAt: sanitizeText(raw?.updatedAt) || timestamp,
    visible: raw?.visible !== false,
    objects,
  };
}

function createMarkupDb() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('Could not open markup storage.'));
  });
}

async function dbReadAll(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () =>
      reject(request.error || new Error('Failed to read markups.'));
  });
}

async function dbPut(db, markup) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('Failed to save markup.'));
    tx.objectStore(STORE_NAME).put(structuredClone(markup));
  });
}

async function dbDelete(db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () =>
      reject(tx.error || new Error('Failed to delete markup.'));
    tx.objectStore(STORE_NAME).delete(id);
  });
}

function valueFromEntityProperty(entity, key) {
  const value = entity?.properties?.[key];
  if (!value) return null;
  if (typeof value.getValue === 'function')
    return value.getValue(Cesium.JulianDate.now());
  return value;
}

function toCesiumPositions(points = []) {
  return points.map((point) =>
    Cesium.Cartesian3.fromDegrees(point.lon, point.lat, point.height || 0),
  );
}

function flattenRouteSegments(segments = []) {
  const points = [];
  for (const segment of segments) {
    if (!Array.isArray(segment) || !segment.length) continue;
    for (const point of segment) {
      const previous = points[points.length - 1];
      if (
        previous &&
        previous.lon === point.lon &&
        previous.lat === point.lat &&
        previous.height === point.height
      ) {
        continue;
      }
      points.push(point);
    }
  }
  return points;
}

function perpendicularDistance(point, start, end) {
  const x = point.lon;
  const y = point.lat;
  const x1 = start.lon;
  const y1 = start.lat;
  const x2 = end.lon;
  const y2 = end.lat;
  if (x1 === x2 && y1 === y2) {
    const dx = x - x1;
    const dy = y - y1;
    return Math.hypot(dx, dy);
  }
  const numerator = Math.abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1);
  const denominator = Math.hypot(y2 - y1, x2 - x1);
  return numerator / denominator;
}

function simplifyDouglasPeucker(points, epsilon) {
  if (!Array.isArray(points) || points.length <= 2) return points.slice();
  let maxDistance = 0;
  let index = 0;
  const start = points[0];
  const end = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], start, end);
    if (distance > maxDistance) {
      index = i;
      maxDistance = distance;
    }
  }
  if (maxDistance <= epsilon) return [start, end];
  const left = simplifyDouglasPeucker(points.slice(0, index + 1), epsilon);
  const right = simplifyDouglasPeucker(points.slice(index), epsilon);
  return [...left.slice(0, -1), ...right];
}

function simplifyRoutePoints(points = []) {
  if (points.length <= 2) return points.slice();
  const deduped = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const current = points[i];
    const previous = deduped[deduped.length - 1];
    if (
      !previous ||
      distanceMeters(previous, current) >= 3 ||
      i === points.length - 1
    ) {
      deduped.push(current);
    }
  }
  if (deduped.length <= 2) return deduped;
  return simplifyDouglasPeucker(deduped, 0.00003);
}

export async function initMarkupPanel({ viewer, showToast = () => {} } = {}) {
  const panel = document.getElementById('scene-panel');
  const home = document.getElementById('markup-home');
  const editor = document.getElementById('markup-editor');
  const savedList = document.getElementById('markup-saved-list');
  const emptyState = document.getElementById('markup-empty-state');
  const status = document.getElementById('markup-status');
  const hint = document.getElementById('markup-tool-hint');
  const newBtn = document.getElementById('markup-new-btn');
  const importBtn = document.getElementById('markup-import-btn');
  const saveBtn = document.getElementById('markup-save-btn');
  const exitBtn = document.getElementById('markup-exit-btn');
  const undoBtn = document.getElementById('markup-undo-btn');
  const importFile = document.getElementById('markup-import-file');
  const routeModeRow = document.getElementById('markup-route-mode-row');
  const compactToggleBtn = document.getElementById('markup-compact-toggle-btn');
  const mobileOverlay = document.getElementById('markup-mobile-overlay');
  const activeControl = document.getElementById('markup-active-control');
  const activeName = document.getElementById('markup-active-name');
  const mobileDoneBtn = document.getElementById('markup-mobile-done-btn');
  const mobileUndoBtn = document.getElementById('markup-mobile-undo-btn');
  const drawingStatus = document.getElementById('markup-drawing-status');
  const drawingStatusTitle = document.getElementById(
    'markup-drawing-status-title',
  );
  const drawingStatusDetail = document.getElementById(
    'markup-drawing-status-detail',
  );
  const statusUndoBtn = document.getElementById('markup-status-undo-btn');
  const statusRedrawBtn = document.getElementById('markup-status-redraw-btn');
  const statusFinishBtn = document.getElementById('markup-status-finish-btn');
  const statusCancelBtn = document.getElementById('markup-status-cancel-btn');
  const managerSheet = document.getElementById('markup-manager-sheet');
  const managerCloseBtn = document.getElementById('markup-manager-close-btn');
  const managerNewBtn = document.getElementById('markup-manager-new-btn');
  const managerImportBtn = document.getElementById('markup-manager-import-btn');
  const managerEmptyState = document.getElementById(
    'markup-manager-empty-state',
  );
  const managerList = document.getElementById('markup-manager-list');
  const metadataSheet = document.getElementById('markup-metadata-sheet');
  const metadataSheetTitle = document.getElementById(
    'markup-metadata-sheet-title',
  );
  const metadataNameInput = document.getElementById('markup-metadata-name');
  const metadataDescriptionInput = document.getElementById(
    'markup-metadata-description',
  );
  const metadataCancelBtn = document.getElementById(
    'markup-metadata-cancel-btn',
  );
  const metadataSubmitBtn = document.getElementById(
    'markup-metadata-submit-btn',
  );
  const objectSheet = document.getElementById('markup-object-sheet');
  const objectSheetContent = document.getElementById(
    'markup-object-sheet-content',
  );
  const objectSheetTitle = document.getElementById('markup-object-sheet-title');
  const objectMinimizeBtn = document.getElementById(
    'markup-object-minimize-btn',
  );
  const objectNameLabel = document.getElementById('markup-object-name-label');
  const objectNameInput = document.getElementById('markup-object-name');
  const objectCategoryLabel = document.getElementById(
    'markup-object-category-label',
  );
  const objectCategorySelect = document.getElementById(
    'markup-object-category',
  );
  const objectCustomWrap = document.getElementById('markup-object-custom-wrap');
  const objectCustomInput = document.getElementById(
    'markup-object-custom-category',
  );
  const objectDescriptionLabel = document.getElementById(
    'markup-object-description-label',
  );
  const objectDescriptionInput = document.getElementById(
    'markup-object-description',
  );
  const objectMoreBtn = document.getElementById('markup-object-more-btn');
  const objectMoreFields = document.getElementById('markup-object-more-fields');
  const objectNotesInput = document.getElementById('markup-object-notes');
  const objectDeleteSecondaryBtn = document.getElementById(
    'markup-object-delete-secondary-btn',
  );
  const objectCancelBtn = document.getElementById('markup-object-cancel-btn');
  const objectSubmitBtn = document.getElementById('markup-object-submit-btn');
  const objectCard = document.getElementById('markup-object-card');
  const objectCardTitle = document.getElementById('markup-object-card-title');
  const objectCardSubtitle = document.getElementById(
    'markup-object-card-subtitle',
  );
  const objectEditBtn = document.getElementById('markup-object-edit-btn');
  const objectHideBtn = document.getElementById('markup-object-hide-btn');
  const objectDeleteBtn = document.getElementById('markup-object-delete-btn');
  const confirmSheet = document.getElementById('markup-confirm-sheet');
  const confirmTitle = document.getElementById('markup-confirm-title');
  const confirmMessage = document.getElementById('markup-confirm-message');
  const confirmCancelBtn = document.getElementById('markup-confirm-cancel-btn');
  const confirmSubmitBtn = document.getElementById('markup-confirm-submit-btn');
  const layoutMedia =
    globalThis.matchMedia?.(MOBILE_LAYOUT_MEDIA_QUERY) || null;
  const body = document.body;

  if (!viewer || !panel || !savedList || !managerList) return null;

  const toolButtons = [
    ...document.querySelectorAll('.markup-tool-btn[data-markup-tool]'),
  ];
  const routeModeButtons = [
    ...document.querySelectorAll('.markup-route-mode-btn[data-route-mode]'),
  ];
  const mobileRouteModeRow = document.getElementById(
    'markup-mobile-route-mode-row',
  );
  const dataSource = new Cesium.CustomDataSource('gev-markups');
  await viewer.dataSources.add(dataSource);

  let db = null;
  let storageEnabled = false;
  let destroyed = false;
  let markups = [];
  let currentMarkupId = null;
  let editing = false;
  let activeTool = null;
  let interactionState = 'idle';
  let formMode = null;
  let routeMode = 'free';
  let drawPoints = [];
  let freeDrawSegments = [];
  let currentFreeDrawSegment = null;
  let isFreeDrawing = false;
  let pendingMarkerPosition = null;
  let circleCenter = null;
  let circleRadiusMeters = 0;
  let lease = null;
  let editHandler = null;
  let savedSingleClick = null;
  let savedDoubleClick = null;
  let editKeyRemover = null;
  let isMobileLayout = Boolean(layoutMedia?.matches);
  let pointPreviewEntity = null;
  let pathPreviewEntity = null;
  let polygonPreviewEntity = null;
  let circlePreviewEntity = null;
  let panelObserver = null;
  let bodyObserver = null;
  let statusResetTimer = null;
  let activeSheet = null;
  let confirmAction = null;
  let confirmResumeSheet = null;
  let selectedObjectRef = null;
  let pendingObjectContext = null;
  let objectSheetMinimized = false;
  let metadataMode = 'create';
  let metadataTargetMarkupId = null;
  let objectDetailsExpanded = false;
  let cameraControlState = null;
  const undoStacks = new Map();
  const listeners = [];

  function currentMarkup() {
    return markups.find((entry) => entry.id === currentMarkupId) || null;
  }

  function currentUndoStack() {
    if (!currentMarkupId) return [];
    if (!undoStacks.has(currentMarkupId)) undoStacks.set(currentMarkupId, []);
    return undoStacks.get(currentMarkupId);
  }

  function emitLayerChange() {
    document.dispatchEvent(new CustomEvent('gev:markup-layer-change'));
  }

  function requestRender() {
    try {
      viewer.scene.requestRender();
    } catch {
      /* ignored */
    }
  }

  function refreshLayerPanel() {
    try {
      window.__gevLayerPanelRefresh?.();
    } catch {
      /* ignored */
    }
  }

  function readSheet(name) {
    if (name === 'manager') return managerSheet;
    if (name === 'metadata') return metadataSheet;
    if (name === 'object') return objectSheet;
    if (name === 'confirm') return confirmSheet;
    return null;
  }

  function updateStatus(text, { ephemeralMs = 0 } = {}) {
    if (status) status.textContent = text;
    if (hint && !activeTool && !editing) hint.textContent = text;
    if (statusResetTimer) {
      clearTimeout(statusResetTimer);
      statusResetTimer = null;
    }
    if (ephemeralMs > 0) {
      statusResetTimer = setTimeout(() => {
        statusResetTimer = null;
        syncStatusCopy();
      }, ephemeralMs);
    }
  }

  function showSavedFeedback(message = '✓ Saved') {
    updateStatus(message, { ephemeralMs: 1800 });
    try {
      showToast(message);
    } catch {
      /* ignored */
    }
  }

  function saveMarkup(markup) {
    return (async () => {
      markup.updatedAt = nowIso();
      if (db) await dbPut(db, markup);
      const index = markups.findIndex((entry) => entry.id === markup.id);
      if (index >= 0) markups[index] = structuredClone(markup);
      else markups.push(structuredClone(markup));
      emitLayerChange();
    })();
  }

  function removeMarkup(id) {
    return (async () => {
      if (db) await dbDelete(db, id);
      markups = markups.filter((entry) => entry.id !== id);
      undoStacks.delete(id);
      emitLayerChange();
    })();
  }

  function findMarkupObject(markupId, objectId) {
    const markup = markups.find((entry) => entry.id === markupId);
    const object = markup?.objects?.find((entry) => entry.id === objectId);
    return { markup, object };
  }

  function populateSelectOptions(select, options) {
    if (!select) return;
    select.textContent = '';
    for (const option of options) {
      const node = document.createElement('option');
      node.value = option;
      node.textContent = option;
      select.appendChild(node);
    }
  }

  function syncObjectCustomField() {
    if (!objectCustomWrap) return;
    const isOther =
      sanitizeText(objectCategorySelect?.value).toLowerCase() === 'other';
    objectCustomWrap.hidden = !objectDetailsExpanded || !isOther;
  }

  function nextDrawingState(tool = activeTool) {
    if (!editing || !tool) return 'idle';
    if (tool === 'marker' || tool === 'delete') return 'placing';
    return 'drawing';
  }

  function syncObjectSheetPresentation() {
    if (!objectSheet || !objectSheetTitle) return;
    const titleBase =
      pendingObjectContext?.mode === 'edit'
        ? `EDIT ${DRAWING_LABELS[pendingObjectContext?.kind] || 'OBJECT'}`
        : objectSheetOptions(pendingObjectContext?.kind).title;
    const canMinimize = pendingObjectContext?.mode === 'create';
    objectSheet.classList.toggle(
      'markup-object-sheet-minimized',
      Boolean(canMinimize && objectSheetMinimized),
    );
    objectSheetTitle.textContent =
      canMinimize && objectSheetMinimized
        ? `${titleBase} • unsaved`
        : titleBase;
    if (objectSheetContent)
      objectSheetContent.hidden = !canMinimize ? false : objectSheetMinimized;
    if (objectMinimizeBtn) {
      objectMinimizeBtn.hidden = !canMinimize;
      objectMinimizeBtn.textContent = objectSheetMinimized ? 'EXPAND' : '˅';
      objectMinimizeBtn.setAttribute(
        'aria-label',
        objectSheetMinimized ? 'Expand details' : 'Minimize details',
      );
      objectMinimizeBtn.setAttribute(
        'aria-expanded',
        String(!objectSheetMinimized),
      );
    }
  }

  function returnToMarkupMap({ clearSelection = true } = {}) {
    hideObjectCard();
    clearPendingObjectDraft();
    closeAllSheets();
    if (clearSelection) viewer.selectedEntity = null;
    formMode = null;
    interactionState = nextDrawingState();
    syncStatusCopy();
  }

  function closeSheet(name, { restoreConfirmSheet = true } = {}) {
    const sheet = readSheet(name);
    if (sheet) sheet.hidden = true;
    if (activeSheet === name) activeSheet = null;
    if (name === 'manager')
      activeControl?.setAttribute('aria-expanded', 'false');
    if (name === 'metadata') {
      metadataTargetMarkupId = null;
      metadataMode = 'create';
    }
    if (name === 'object') {
      pendingObjectContext = null;
      formMode = null;
      interactionState = nextDrawingState();
      objectSheetMinimized = false;
      objectDetailsExpanded = false;
      if (objectMoreFields) objectMoreFields.hidden = true;
      syncObjectCustomField();
      syncObjectSheetPresentation();
    }
    if (name === 'confirm') {
      confirmAction = null;
      const resumeSheet = confirmResumeSheet;
      confirmResumeSheet = null;
      if (
        restoreConfirmSheet &&
        resumeSheet &&
        !readSheet(resumeSheet)?.hidden
      ) {
        activeSheet = resumeSheet;
      }
    }
  }

  function closeAllSheets({ keep = null } = {}) {
    for (const name of ['manager', 'metadata', 'object', 'confirm']) {
      if (name === keep) continue;
      closeSheet(name);
    }
  }

  function openSheet(name) {
    closeAllSheets({ keep: name });
    const sheet = readSheet(name);
    if (!sheet) return;
    sheet.hidden = false;
    activeSheet = name;
    if (name === 'manager')
      activeControl?.setAttribute('aria-expanded', 'true');
  }

  function syncActiveMarkupLabel() {
    const markup = currentMarkup();
    if (activeName) activeName.textContent = markup?.name || 'SELECT MARKUP';
  }

  function renderMap() {
    dataSource.entities.removeAll();
    pointPreviewEntity = null;
    pathPreviewEntity = null;
    polygonPreviewEntity = null;
    circlePreviewEntity = null;
    for (const markup of markups) {
      if (markup.visible === false) continue;
      for (const object of markup.objects || []) {
        if (object.visible === false) continue;
        if (!validateMarkupObject(object)) continue;
        const entityBase = {
          properties: {
            gevMarkupId: markup.id,
            gevMarkupObjectId: object.id,
            gevMarkupType: object.type,
            gevMarkupCategory: object.category,
            gevMarkupVisible: object.visible !== false,
          },
        };
        if (object.type === 'marker') {
          dataSource.entities.add({
            ...entityBase,
            id: `markup-${markup.id}-${object.id}`,
            position: Cesium.Cartesian3.fromDegrees(
              object.geometry.position.lon,
              object.geometry.position.lat,
              object.geometry.position.height || 0,
            ),
            point: {
              pixelSize: 10,
              color: Cesium.Color.CYAN.withAlpha(0.95),
              outlineColor: Cesium.Color.BLACK.withAlpha(0.7),
              outlineWidth: 2,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: {
              text: object.title || object.category || 'Marker',
              showBackground: true,
              font: '12px "IBM Plex Sans", sans-serif',
              fillColor: Cesium.Color.WHITE,
              backgroundColor:
                Cesium.Color.fromCssColorString('#101820').withAlpha(0.78),
              style: Cesium.LabelStyle.FILL,
              pixelOffset: new Cesium.Cartesian2(0, -22),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              horizontalOrigin: Cesium.HorizontalOrigin.CENTER,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
            },
          });
          continue;
        }
        if (object.type === 'line') {
          dataSource.entities.add({
            ...entityBase,
            id: `markup-${markup.id}-${object.id}`,
            polyline: {
              positions: toCesiumPositions(object.geometry.points),
              width: 3,
              clampToGround: true,
              material: Cesium.Color.CYAN.withAlpha(0.92),
            },
          });
          continue;
        }
        if (object.type === 'polygon') {
          dataSource.entities.add({
            ...entityBase,
            id: `markup-${markup.id}-${object.id}`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(
                toCesiumPositions(object.geometry.points || []),
              ),
              material: Cesium.Color.CYAN.withAlpha(0.2),
              outline: true,
              outlineColor: Cesium.Color.CYAN.withAlpha(0.9),
              perPositionHeight: false,
            },
          });
          continue;
        }
        if (object.type === 'circle') {
          dataSource.entities.add({
            ...entityBase,
            id: `markup-${markup.id}-${object.id}`,
            position: Cesium.Cartesian3.fromDegrees(
              object.geometry.center.lon,
              object.geometry.center.lat,
              object.geometry.center.height || 0,
            ),
            ellipse: {
              semiMinorAxis: object.geometry.radiusMeters,
              semiMajorAxis: object.geometry.radiusMeters,
              material: Cesium.Color.CYAN.withAlpha(0.14),
              outline: true,
              outlineColor: Cesium.Color.CYAN.withAlpha(0.92),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
          });
        }
      }
    }
    syncPreviewEntities();
    requestRender();
  }

  function previewRoutePoints() {
    if (routeMode === 'points') return drawPoints.slice();
    return flattenRouteSegments([
      ...freeDrawSegments,
      ...(currentFreeDrawSegment?.length ? [currentFreeDrawSegment] : []),
    ]);
  }

  function clearPreviewEntities() {
    if (pointPreviewEntity) {
      dataSource.entities.remove(pointPreviewEntity);
      pointPreviewEntity = null;
    }
    if (pathPreviewEntity) {
      dataSource.entities.remove(pathPreviewEntity);
      pathPreviewEntity = null;
    }
    if (polygonPreviewEntity) {
      dataSource.entities.remove(polygonPreviewEntity);
      polygonPreviewEntity = null;
    }
    if (circlePreviewEntity) {
      dataSource.entities.remove(circlePreviewEntity);
      circlePreviewEntity = null;
    }
  }

  function syncPreviewEntities() {
    clearPreviewEntities();
    if (!editing) return;
    if (activeTool === 'marker' && pendingMarkerPosition) {
      pointPreviewEntity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          pendingMarkerPosition.lon,
          pendingMarkerPosition.lat,
          pendingMarkerPosition.height || 0,
        ),
        point: {
          pixelSize: 12,
          color: Cesium.Color.CYAN.withAlpha(0.95),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      requestRender();
      return;
    }
    if (activeTool === 'line') {
      const points = previewRoutePoints();
      if (points.length === 1) {
        pointPreviewEntity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(
            points[0].lon,
            points[0].lat,
            points[0].height || 0,
          ),
          point: {
            pixelSize: 10,
            color: Cesium.Color.CYAN.withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      if (points.length >= 2) {
        pathPreviewEntity = dataSource.entities.add({
          polyline: {
            positions: toCesiumPositions(points),
            width: 4,
            clampToGround: true,
            material: Cesium.Color.CYAN.withAlpha(0.9),
          },
        });
      }
      requestRender();
      return;
    }
    if (activeTool === 'polygon') {
      if (drawPoints.length === 1) {
        pointPreviewEntity = dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(
            drawPoints[0].lon,
            drawPoints[0].lat,
            drawPoints[0].height || 0,
          ),
          point: {
            pixelSize: 10,
            color: Cesium.Color.CYAN.withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      }
      if (drawPoints.length >= 2) {
        pathPreviewEntity = dataSource.entities.add({
          polyline: {
            positions: toCesiumPositions(drawPoints),
            width: 4,
            clampToGround: true,
            material: Cesium.Color.CYAN.withAlpha(0.9),
          },
        });
      }
      if (drawPoints.length >= 3) {
        polygonPreviewEntity = dataSource.entities.add({
          polygon: {
            hierarchy: new Cesium.PolygonHierarchy(
              toCesiumPositions(drawPoints),
            ),
            material: Cesium.Color.CYAN.withAlpha(0.26),
            outline: true,
            outlineColor: Cesium.Color.CYAN.withAlpha(0.92),
            perPositionHeight: false,
          },
        });
      }
      requestRender();
      return;
    }
    if (activeTool === 'circle' && circleCenter) {
      circlePreviewEntity = dataSource.entities.add({
        position: Cesium.Cartesian3.fromDegrees(
          circleCenter.lon,
          circleCenter.lat,
          circleCenter.height || 0,
        ),
        ellipse: {
          semiMinorAxis: Math.max(circleRadiusMeters, 1),
          semiMajorAxis: Math.max(circleRadiusMeters, 1),
          material: Cesium.Color.CYAN.withAlpha(0.14),
          outline: true,
          outlineColor: Cesium.Color.CYAN.withAlpha(0.92),
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
      requestRender();
    }
  }

  function clearTransientGeometry() {
    drawPoints = [];
    freeDrawSegments = [];
    currentFreeDrawSegment = null;
    isFreeDrawing = false;
    pendingMarkerPosition = null;
    circleCenter = null;
    circleRadiusMeters = 0;
    restoreCameraControls();
    syncPreviewEntities();
  }

  function syncRouteModeButtons() {
    routeModeRow.hidden = activeTool !== 'line';
    if (mobileRouteModeRow)
      mobileRouteModeRow.hidden = !(isMobileLayout && activeTool === 'line');
    for (const button of routeModeButtons) {
      const on = button.dataset.routeMode === routeMode;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function isMobileMarkupPresentationActive() {
    return (
      isMobileLayout &&
      body?.dataset?.mobilePanel === 'markup' &&
      !panel.classList.contains('collapsed')
    );
  }

  function syncStatusCopy() {
    const drawingLabel = activeTool ? DRAWING_LABELS[activeTool] : 'MARKUP';
    if (hint) {
      if (!editing) hint.textContent = 'Select a markup to begin.';
      else if (interactionState === 'details' && formMode === 'edit')
        hint.textContent = 'Update details, then save or cancel.';
      else if (interactionState === 'details')
        hint.textContent = 'Add details, then save or cancel.';
      else if (!activeTool)
        hint.textContent = 'Choose a tool and draw directly on the map.';
      else if (activeTool === 'marker') hint.textContent = 'Tap map to place.';
      else if (activeTool === 'polygon')
        hint.textContent = 'Tap points to draw an area.';
      else if (activeTool === 'circle')
        hint.textContent = circleCenter
          ? 'Drag or release to set radius.'
          : 'Tap center, then drag to set radius.';
      else if (activeTool === 'delete')
        hint.textContent = 'Tap an object to delete it.';
      else if (routeMode === 'free')
        hint.textContent = 'Drag on the map to draw a route.';
      else hint.textContent = 'Tap points to draw a route.';
    }
    if (!drawingStatus) return;
    if (
      !editing ||
      !isMobileMarkupPresentationActive() ||
      interactionState === 'details'
    ) {
      drawingStatus.hidden = true;
      return;
    }
    if (!activeTool) {
      drawingStatus.hidden = true;
      return;
    }
    drawingStatus.hidden = false;
    if (drawingStatusTitle) drawingStatusTitle.textContent = drawingLabel;
    let detail = '';
    let showUndo = false;
    let showRedraw = false;
    let showFinish = false;
    let showCancel = true;
    if (activeTool === 'marker') {
      detail = 'Tap map to place';
    } else if (activeTool === 'polygon') {
      detail = `Tap points to draw\n${drawPoints.length} point${drawPoints.length === 1 ? '' : 's'}`;
      showUndo = drawPoints.length > 0;
      showFinish = drawPoints.length >= 3;
    } else if (activeTool === 'circle') {
      detail = circleCenter
        ? `Drag to set radius${circleRadiusMeters ? `\n${Math.round(circleRadiusMeters)} m` : ''}`
        : 'Tap center, then drag';
    } else if (activeTool === 'delete') {
      detail = 'Tap object to delete';
      showCancel = true;
    } else if (routeMode === 'free') {
      const count = previewRoutePoints().length;
      detail = isFreeDrawing
        ? 'Free Draw\nRelease to stop'
        : count >= 2
          ? 'Free Draw\nRoute ready'
          : 'Free Draw\nDrag on map';
      showUndo = freeDrawSegments.length > 0;
      showRedraw = count > 0;
      showFinish = count >= 2 && !isFreeDrawing;
    } else {
      detail = `Points\n${drawPoints.length} point${drawPoints.length === 1 ? '' : 's'}`;
      showUndo = drawPoints.length > 0;
      showFinish = drawPoints.length >= 2;
    }
    if (drawingStatusDetail) drawingStatusDetail.textContent = detail;
    if (statusUndoBtn) statusUndoBtn.hidden = !showUndo;
    if (statusRedrawBtn) statusRedrawBtn.hidden = !showRedraw;
    if (statusFinishBtn) statusFinishBtn.hidden = !showFinish;
    if (statusCancelBtn) statusCancelBtn.hidden = !showCancel;
    syncRouteModeButtons();
  }

  function syncMobilePresentation() {
    const mobileMode = Boolean(editing && isMobileMarkupPresentationActive());
    panel.classList.toggle('markup-mobile-mode', mobileMode);
    if (mobileOverlay) mobileOverlay.hidden = !mobileMode;
    if (compactToggleBtn) compactToggleBtn.hidden = true;
    syncStatusCopy();
  }

  function hideObjectCard() {
    selectedObjectRef = null;
    if (objectCard) objectCard.hidden = true;
  }

  function setObjectCard(markupId, objectId) {
    const { markup, object } = findMarkupObject(markupId, objectId);
    if (!markup || !object || !objectCard) {
      hideObjectCard();
      return;
    }
    selectedObjectRef = { markupId, objectId };
    objectCard.hidden = false;
    if (objectCardTitle) {
      objectCardTitle.textContent =
        object.title ||
        object.category ||
        DRAWING_LABELS[object.type] ||
        'Object';
    }
    if (objectCardSubtitle) {
      objectCardSubtitle.textContent =
        object.category || object.type || 'Markup object';
    }
    if (objectHideBtn) {
      objectHideBtn.textContent = object.visible === false ? 'SHOW' : 'HIDE';
    }
  }

  function setEditingState(enabled) {
    editing = Boolean(enabled);
    panel.classList.toggle('markup-editing', editing);
    if (editor) editor.hidden = !editing;
    if (home) home.hidden = editing;
    if (!editing) {
      interactionState = 'idle';
      formMode = null;
      closeAllSheets();
      hideObjectCard();
      clearTransientGeometry();
      activeTool = null;
      viewer.selectedEntity = null;
    }
    syncToolButtons();
    syncRouteModeButtons();
    syncActiveMarkupLabel();
    syncMobilePresentation();
  }

  function syncToolButtons() {
    for (const button of toolButtons) {
      const on = button.dataset.markupTool === activeTool;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }

  function withCameraController(callback) {
    const controller = viewer?.scene?.screenSpaceCameraController;
    if (!controller) return;
    callback(controller);
  }

  function lockCameraControls() {
    if (cameraControlState) return;
    withCameraController((controller) => {
      cameraControlState = {
        enableTranslate: controller.enableTranslate,
        enableRotate: controller.enableRotate,
        enableTilt: controller.enableTilt,
        enableLook: controller.enableLook,
        enableZoom: controller.enableZoom,
      };
      controller.enableTranslate = false;
      controller.enableRotate = false;
      controller.enableTilt = false;
      controller.enableLook = false;
      controller.enableZoom = false;
    });
  }

  function restoreCameraControls() {
    if (!cameraControlState) return;
    withCameraController((controller) => {
      controller.enableTranslate = cameraControlState.enableTranslate;
      controller.enableRotate = cameraControlState.enableRotate;
      controller.enableTilt = cameraControlState.enableTilt;
      controller.enableLook = cameraControlState.enableLook;
      controller.enableZoom = cameraControlState.enableZoom;
    });
    cameraControlState = null;
  }

  function syncLayersApi() {
    window.__gevMarkupsLayerApi = {
      list: () =>
        markups.map((markup) => ({
          id: markup.id,
          name: markup.name,
          visible: markup.visible !== false,
        })),
      setVisible: async (markupId, visible) => {
        const markup = markups.find((entry) => entry.id === markupId);
        if (!markup) return false;
        markup.visible = Boolean(visible);
        await saveMarkup(markup);
        renderMap();
        renderSavedMarkups();
        refreshLayerPanel();
        showSavedFeedback();
        return true;
      },
      subscribe: (listener) => {
        if (typeof listener !== 'function') return () => {};
        const handler = () => listener();
        document.addEventListener('gev:markup-layer-change', handler);
        return () =>
          document.removeEventListener('gev:markup-layer-change', handler);
      },
    };
  }

  async function addObjectToMarkup(markupId, object, message = '✓ Saved') {
    const markup = markups.find((entry) => entry.id === markupId);
    if (!markup) return false;
    markup.objects.push(object);
    if (!undoStacks.has(markup.id)) undoStacks.set(markup.id, []);
    undoStacks
      .get(markup.id)
      .push({ type: 'add', object: structuredClone(object) });
    await saveMarkup(markup);
    renderMap();
    renderSavedMarkups();
    refreshLayerPanel();
    showSavedFeedback(message);
    return true;
  }

  async function updateObject(
    markupId,
    objectId,
    updater,
    message = '✓ Saved',
  ) {
    const { markup, object } = findMarkupObject(markupId, objectId);
    if (!markup || !object) return false;
    const before = structuredClone(object);
    updater(object);
    object.updatedAt = nowIso();
    if (!undoStacks.has(markup.id)) undoStacks.set(markup.id, []);
    undoStacks.get(markup.id).push({
      type: 'update',
      objectId,
      before,
      after: structuredClone(object),
    });
    await saveMarkup(markup);
    renderMap();
    renderSavedMarkups();
    refreshLayerPanel();
    showSavedFeedback(message);
    return true;
  }

  async function removeObjectFromMarkup(
    markupId,
    objectId,
    message = '✓ Saved',
  ) {
    const markup = markups.find((entry) => entry.id === markupId);
    if (!markup) return false;
    const index = markup.objects.findIndex((entry) => entry.id === objectId);
    if (index < 0) return false;
    const [removed] = markup.objects.splice(index, 1);
    if (!undoStacks.has(markup.id)) undoStacks.set(markup.id, []);
    undoStacks.get(markup.id).push({
      type: 'remove',
      object: structuredClone(removed),
    });
    await saveMarkup(markup);
    if (selectedObjectRef?.objectId === objectId) hideObjectCard();
    renderMap();
    renderSavedMarkups();
    refreshLayerPanel();
    showSavedFeedback(message);
    return true;
  }

  function markupRow(markup, { forManager = false } = {}) {
    const row = document.createElement('div');
    row.className = 'markup-row';
    row.dataset.markupId = markup.id;

    const top = document.createElement('div');
    top.className = 'markup-row-top';
    row.appendChild(top);

    const titleWrap = document.createElement('div');
    titleWrap.className = 'markup-row-title-wrap';
    top.appendChild(titleWrap);

    const title = document.createElement('div');
    title.className = 'markup-row-title';
    title.textContent = markup.name;
    titleWrap.appendChild(title);

    if (markup.id === currentMarkupId) {
      const badge = document.createElement('div');
      badge.className = 'markup-row-badge';
      badge.textContent = 'ACTIVE';
      titleWrap.appendChild(badge);
    }

    const actions = document.createElement('div');
    actions.className = 'markup-row-actions';
    top.appendChild(actions);

    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'scene-btn';
    useBtn.dataset.action = 'use';
    useBtn.dataset.markupId = markup.id;
    useBtn.textContent = markup.id === currentMarkupId ? 'OPEN' : 'USE';
    actions.appendChild(useBtn);

    const visibilityBtn = document.createElement('button');
    visibilityBtn.type = 'button';
    visibilityBtn.className = `scene-btn ${markup.visible !== false ? 'active' : ''}`;
    visibilityBtn.dataset.action = 'toggle-visibility';
    visibilityBtn.dataset.markupId = markup.id;
    visibilityBtn.textContent = markup.visible !== false ? 'VISIBLE' : 'HIDDEN';
    actions.appendChild(visibilityBtn);

    const renameBtn = document.createElement('button');
    renameBtn.type = 'button';
    renameBtn.className = 'scene-btn';
    renameBtn.dataset.action = 'rename';
    renameBtn.dataset.markupId = markup.id;
    renameBtn.textContent = 'RENAME';
    actions.appendChild(renameBtn);

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.className = 'scene-btn';
    exportBtn.dataset.action = 'export';
    exportBtn.dataset.markupId = markup.id;
    exportBtn.textContent = 'EXPORT';
    actions.appendChild(exportBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'scene-btn scene-btn-danger';
    deleteBtn.dataset.action = 'delete';
    deleteBtn.dataset.markupId = markup.id;
    deleteBtn.textContent = 'DELETE';
    actions.appendChild(deleteBtn);

    if (markup.description) {
      const description = document.createElement('div');
      description.className = 'markup-row-description';
      description.textContent = markup.description;
      row.appendChild(description);
    }

    if (forManager) row.classList.add('markup-manager-row');
    return row;
  }

  function renderSavedMarkups() {
    const sorted = markups.slice().sort((a, b) => a.name.localeCompare(b.name));
    savedList.textContent = '';
    managerList.textContent = '';
    if (emptyState) emptyState.hidden = sorted.length > 0;
    if (managerEmptyState) managerEmptyState.hidden = sorted.length > 0;
    for (const markup of sorted) {
      savedList.appendChild(markupRow(markup));
      managerList.appendChild(markupRow(markup, { forManager: true }));
    }
    syncActiveMarkupLabel();
  }

  function activeMarkupFallback() {
    if (currentMarkupId && currentMarkup()) return currentMarkupId;
    const candidate =
      markups.find((entry) => entry.visible !== false) || markups[0];
    return candidate?.id || null;
  }

  function enterMarkupMode({ markupId = null, openCreateIfEmpty = true } = {}) {
    currentMarkupId = markupId || activeMarkupFallback();
    setEditingState(true);
    returnToMarkupMap();
    renderSavedMarkups();
    renderMap();
    if (!currentMarkupId && openCreateIfEmpty) {
      if (markups.length) {
        openSheet('manager');
      } else {
        openMarkupMetadataSheet({ mode: 'create' });
      }
    }
    updateStatus(
      currentMarkupId
        ? `Editing ${currentMarkup()?.name || 'markup'}`
        : 'Create a markup to begin.',
    );
  }

  function leaveMarkupMode({ collapseMobilePanel = false } = {}) {
    setEditingState(false);
    if (
      collapseMobilePanel &&
      isMobileLayout &&
      !panel.classList.contains('collapsed')
    ) {
      const collapseButton = panel.querySelector(
        '.panel-collapse-btn[data-collapse-target="scene-panel"]',
      );
      collapseButton?.click();
    }
    syncStatusCopy();
  }

  function pickMarkupObject(position) {
    const pick = viewer.scene.pick(position);
    const markupId = valueFromEntityProperty(pick?.id, 'gevMarkupId');
    const objectId = valueFromEntityProperty(pick?.id, 'gevMarkupObjectId');
    if (!markupId || !objectId) return null;
    const found = findMarkupObject(markupId, objectId);
    if (!found.markup || !found.object) return null;
    return {
      markupId,
      objectId,
      markup: found.markup,
      object: found.object,
    };
  }

  function objectSheetOptions(kind) {
    if (kind === 'line') {
      return {
        title: 'NEW ROUTE',
        submit: 'ADD ROUTE',
        categoryLabel: 'Type',
        options: ROUTE_TYPE_OPTIONS,
      };
    }
    if (kind === 'polygon') {
      return {
        title: 'NEW AREA',
        submit: 'ADD AREA',
        categoryLabel: 'Category',
        options: DEFAULT_CATEGORIES,
      };
    }
    if (kind === 'circle') {
      return {
        title: 'NEW RADIUS',
        submit: 'ADD RADIUS',
        categoryLabel: 'Category',
        options: DEFAULT_CATEGORIES,
      };
    }
    return {
      title: 'NEW MARKER',
      submit: 'ADD MARKER',
      categoryLabel: 'Category',
      options: DEFAULT_CATEGORIES,
    };
  }

  function openMarkupMetadataSheet({ mode, markupId = null } = {}) {
    const markup = markupId
      ? markups.find((entry) => entry.id === markupId)
      : null;
    metadataMode = mode === 'edit' ? 'edit' : 'create';
    metadataTargetMarkupId = markup?.id || null;
    metadataSheetTitle.textContent =
      metadataMode === 'edit' ? 'EDIT MARKUP' : 'NEW MARKUP';
    metadataSubmitBtn.textContent = metadataMode === 'edit' ? 'SAVE' : 'CREATE';
    metadataNameInput.value = markup?.name || '';
    metadataDescriptionInput.value = markup?.description || '';
    openSheet('metadata');
    metadataNameInput.focus();
  }

  function openObjectSheet({
    mode = 'create',
    kind,
    geometry = null,
    markupId = null,
    objectId = null,
  } = {}) {
    const config = objectSheetOptions(kind);
    const seed =
      mode === 'edit' && markupId && objectId
        ? findMarkupObject(markupId, objectId).object
        : null;
    pendingObjectContext = {
      mode,
      kind,
      geometry,
      markupId,
      objectId,
    };
    formMode = mode;
    interactionState = 'details';
    objectSheetMinimized = false;
    objectSubmitBtn.textContent =
      mode === 'edit' ? 'SAVE CHANGES' : config.submit;
    if (objectDeleteSecondaryBtn) {
      objectDeleteSecondaryBtn.hidden = mode !== 'edit';
      objectDeleteSecondaryBtn.textContent = `DELETE ${DRAWING_LABELS[kind] || 'OBJECT'}`;
    }
    objectNameLabel.textContent =
      kind === 'polygon' || kind === 'line' || kind === 'circle'
        ? 'Name *'
        : 'Title *';
    objectCategoryLabel.textContent = config.categoryLabel;
    objectDescriptionLabel.textContent = 'Description';
    populateSelectOptions(objectCategorySelect, config.options);
    objectNameInput.value = seed?.title || '';
    const normalizedCategory = normalizeCategory(
      seed?.category,
      config.options,
    );
    objectCategorySelect.value = normalizedCategory;
    if (
      !config.options.some(
        (entry) => entry.toLowerCase() === normalizedCategory.toLowerCase(),
      )
    ) {
      objectCategorySelect.value = 'Other';
    }
    objectDetailsExpanded =
      Boolean(seed?.notes) || objectCategorySelect.value === 'Other';
    objectCustomInput.value =
      objectCategorySelect.value === 'Other' ? seed?.category || '' : '';
    objectDescriptionInput.value = seed?.description || '';
    objectNotesInput.value = seed?.notes || '';
    objectMoreFields.hidden = !objectDetailsExpanded;
    objectMoreBtn.textContent = objectDetailsExpanded
      ? 'LESS DETAILS'
      : 'MORE DETAILS';
    syncObjectCustomField();
    syncObjectSheetPresentation();
    openSheet('object');
    syncStatusCopy();
    objectNameInput.focus();
  }

  function clearPendingObjectDraft() {
    pendingObjectContext = null;
    formMode = null;
    objectSheetMinimized = false;
    objectDetailsExpanded = false;
    if (objectMoreFields) objectMoreFields.hidden = true;
    syncObjectCustomField();
    syncObjectSheetPresentation();
  }

  function showConfirm({
    title,
    message,
    confirmLabel = 'DELETE',
    confirmClassName = 'scene-btn scene-btn-danger',
    preserveSheet = null,
    onConfirm,
  }) {
    confirmTitle.textContent = title;
    confirmMessage.textContent = message;
    confirmSubmitBtn.textContent = confirmLabel;
    confirmSubmitBtn.className = confirmClassName;
    confirmAction = onConfirm;
    confirmResumeSheet = preserveSheet;
    if (preserveSheet) {
      closeAllSheets({ keep: preserveSheet });
      confirmSheet.hidden = false;
      activeSheet = 'confirm';
    } else {
      openSheet('confirm');
    }
  }

  function syncSelectedEntityCard() {
    if (!editing || activeTool) {
      hideObjectCard();
      return;
    }
    const entity = viewer.selectedEntity;
    const markupId = valueFromEntityProperty(entity, 'gevMarkupId');
    const objectId = valueFromEntityProperty(entity, 'gevMarkupObjectId');
    if (!markupId || !objectId) {
      hideObjectCard();
      return;
    }
    currentMarkupId = markupId;
    syncActiveMarkupLabel();
    selectedObjectRef = { markupId, objectId };
    openObjectSheet({
      mode: 'edit',
      kind: findMarkupObject(markupId, objectId).object.type,
      markupId,
      objectId,
    });
  }

  function selectTool(tool) {
    activeTool = tool || null;
    interactionState = nextDrawingState(tool);
    formMode = null;
    clearTransientGeometry();
    closeAllSheets();
    hideObjectCard();
    viewer.selectedEntity = null;
    syncToolButtons();
    syncRouteModeButtons();
    syncStatusCopy();
    bindEditingHandler();
  }

  function worldAt(position) {
    const canvas = viewer.scene.canvas;
    const width = canvas.clientWidth || canvas.width || 1;
    const height = canvas.clientHeight || canvas.height || 1;
    return pickWorldFromScreen(viewer, position.x / width, position.y / height);
  }

  function beginFreeDraw(coordinate) {
    if (!coordinate) return;
    isFreeDrawing = true;
    currentFreeDrawSegment = [coordinate];
    lockCameraControls();
    syncPreviewEntities();
    syncStatusCopy();
  }

  function pushFreeDrawPoint(coordinate) {
    if (!isFreeDrawing || !coordinate) return;
    const segment = currentFreeDrawSegment || [];
    const previous = segment[segment.length - 1];
    if (previous && distanceMeters(previous, coordinate) < 4) return;
    segment.push(coordinate);
    currentFreeDrawSegment = segment;
    syncPreviewEntities();
  }

  function finishFreeDrawSegment() {
    if (!isFreeDrawing) return;
    isFreeDrawing = false;
    restoreCameraControls();
    if (currentFreeDrawSegment?.length >= 2) {
      freeDrawSegments.push(simplifyRoutePoints(currentFreeDrawSegment));
    }
    currentFreeDrawSegment = null;
    syncPreviewEntities();
    syncStatusCopy();
  }

  function finishRoutePoints() {
    if (routeMode === 'free') {
      const points = simplifyRoutePoints(previewRoutePoints());
      if (points.length < 2) return false;
      openObjectSheet({
        mode: 'create',
        kind: 'line',
        geometry: { points },
        markupId: currentMarkupId,
      });
      return true;
    }
    if (drawPoints.length < 2) return false;
    openObjectSheet({
      mode: 'create',
      kind: 'line',
      geometry: { points: structuredClone(drawPoints) },
      markupId: currentMarkupId,
    });
    return true;
  }

  function finishPolygon() {
    if (drawPoints.length < 3) return false;
    openObjectSheet({
      mode: 'create',
      kind: 'polygon',
      geometry: { points: structuredClone(drawPoints) },
      markupId: currentMarkupId,
    });
    return true;
  }

  function cancelDrawing({ clearTool = true } = {}) {
    clearTransientGeometry();
    if (clearTool) activeTool = null;
    interactionState = nextDrawingState(clearTool ? null : activeTool);
    formMode = null;
    syncToolButtons();
    syncStatusCopy();
    bindEditingHandler();
    updateStatus('Drawing cancelled.');
  }

  function redrawRoute() {
    clearTransientGeometry();
    syncStatusCopy();
    updateStatus('Route cleared.');
  }

  function undoDrawingPoint() {
    if (activeTool === 'line') {
      if (routeMode === 'free') {
        if (isFreeDrawing) {
          if (currentFreeDrawSegment?.length > 1) currentFreeDrawSegment.pop();
          else currentFreeDrawSegment = [];
        } else {
          freeDrawSegments.pop();
        }
        syncPreviewEntities();
        syncStatusCopy();
        updateStatus('Removed last drawing step.');
        return;
      }
      if (!drawPoints.length) return;
      drawPoints.pop();
      syncPreviewEntities();
      syncStatusCopy();
      updateStatus('Removed last drawing step.');
      return;
    }
    if (activeTool === 'polygon') {
      if (!drawPoints.length) return;
      drawPoints.pop();
      syncPreviewEntities();
      syncStatusCopy();
      updateStatus('Removed last drawing step.');
      return;
    }
    if (activeTool === 'circle' && circleCenter) {
      circleCenter = null;
      circleRadiusMeters = 0;
      syncPreviewEntities();
      syncStatusCopy();
      updateStatus('Removed last drawing step.');
    }
  }

  async function finishActiveGeometry() {
    if (!editing || !activeTool) return false;
    if (activeTool === 'line') return finishRoutePoints();
    if (activeTool === 'polygon') return finishPolygon();
    return false;
  }

  function bindEditingHandler() {
    if (editHandler) {
      editHandler.destroy();
      editHandler = null;
    }
    if (savedSingleClick) {
      viewer.screenSpaceEventHandler.setInputAction(
        savedSingleClick,
        Cesium.ScreenSpaceEventType.LEFT_CLICK,
      );
      savedSingleClick = null;
    }
    if (savedDoubleClick) {
      viewer.screenSpaceEventHandler.setInputAction(
        savedDoubleClick,
        Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
      );
      savedDoubleClick = null;
    }
    editKeyRemover?.();
    editKeyRemover = null;
    if (lease) {
      releasePointer(lease);
      lease = null;
    }
    restoreCameraControls();
    if (!editing || !activeTool) return;
    if (isMobileLayout && !isMobileMarkupPresentationActive()) return;
    lease = claimPointer(MARKUP_POINTER_OWNER);
    if (!lease) {
      updateStatus(`${pointerOwner()} is using the pointer — close it first.`);
      activeTool = null;
      interactionState = 'idle';
      formMode = null;
      syncToolButtons();
      syncStatusCopy();
      return;
    }
    const stock = viewer.screenSpaceEventHandler;
    savedSingleClick =
      stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK) || null;
    savedDoubleClick =
      stock.getInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK) ||
      null;
    stock.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_CLICK);
    stock.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    editHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    editHandler.setInputAction(async (event) => {
      if (activeSheet === 'object') return;
      const world = worldAt(event.position);
      const coordinate = coordFromWorld(world);
      if (activeTool === 'marker') {
        if (!coordinate || !currentMarkupId) return;
        pendingMarkerPosition = structuredClone(coordinate);
        syncPreviewEntities();
        openObjectSheet({
          mode: 'create',
          kind: 'marker',
          geometry: { position: structuredClone(pendingMarkerPosition) },
          markupId: currentMarkupId,
        });
        return;
      }
      if (activeTool === 'line' && routeMode === 'points') {
        if (!coordinate) return;
        drawPoints.push(coordinate);
        syncPreviewEntities();
        syncStatusCopy();
        return;
      }
      if (activeTool === 'polygon') {
        if (!coordinate) return;
        drawPoints.push(coordinate);
        syncPreviewEntities();
        syncStatusCopy();
        return;
      }
      if (activeTool === 'delete') {
        const found = pickMarkupObject(event.position);
        if (!found) return;
        if (found.markupId !== currentMarkupId) {
          updateStatus(
            'Delete mode only removes objects from the active markup.',
          );
          return;
        }
        showConfirm({
          title: `Delete "${found.object.title || found.object.category || 'markup object'}"?`,
          message: 'This object will be removed from the active markup.',
          onConfirm: async () => {
            await removeObjectFromMarkup(found.markupId, found.objectId);
            viewer.selectedEntity = null;
          },
        });
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    editHandler.setInputAction(async () => {
      if (activeTool === 'line' && routeMode === 'points') {
        await finishActiveGeometry();
      }
      if (activeTool === 'polygon') await finishActiveGeometry();
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    editHandler.setInputAction((event) => {
      const world = worldAt(event.position);
      const coordinate = coordFromWorld(world);
      if (activeTool === 'line' && routeMode === 'free') {
        if (!coordinate) return;
        beginFreeDraw(coordinate);
        return;
      }
      if (activeTool === 'circle') {
        if (!coordinate) return;
        circleCenter = coordinate;
        circleRadiusMeters = 1;
        lockCameraControls();
        syncPreviewEntities();
        syncStatusCopy();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    editHandler.setInputAction((event) => {
      const coordinate = coordFromWorld(worldAt(event.endPosition));
      if (activeTool === 'line' && routeMode === 'free') {
        pushFreeDrawPoint(coordinate);
        return;
      }
      if (activeTool === 'circle' && circleCenter && coordinate) {
        circleRadiusMeters = Math.max(
          1,
          distanceMeters(circleCenter, coordinate),
        );
        syncPreviewEntities();
        syncStatusCopy();
      }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    editHandler.setInputAction(() => {
      if (activeTool === 'line' && routeMode === 'free') {
        finishFreeDrawSegment();
        return;
      }
      if (activeTool === 'circle' && circleCenter) {
        restoreCameraControls();
        if (circleRadiusMeters > 0) {
          openObjectSheet({
            mode: 'create',
            kind: 'circle',
            geometry: {
              center: structuredClone(circleCenter),
              radiusMeters: Math.max(circleRadiusMeters, 1),
            },
            markupId: currentMarkupId,
          });
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    const onKey = async (event) => {
      if (!editing) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (activeSheet) {
          if (activeSheet === 'object') {
            if (pendingObjectContext?.mode === 'create')
              clearTransientGeometry();
            returnToMarkupMap();
            return;
          }
          closeSheet(activeSheet);
          syncStatusCopy();
          return;
        }
        if (activeTool) {
          cancelDrawing();
          return;
        }
        leaveMarkupMode({ collapseMobilePanel: isMobileLayout });
      }
      if (
        event.key === 'Enter' &&
        activeTool &&
        ((activeTool === 'line' && routeMode === 'points') ||
          activeTool === 'polygon')
      ) {
        event.preventDefault();
        await finishActiveGeometry();
      }
    };
    document.addEventListener('keydown', onKey, true);
    editKeyRemover = () => document.removeEventListener('keydown', onKey, true);
  }

  function exportMarkup(markupId) {
    const markup = markups.find((entry) => entry.id === markupId);
    if (!markup) return;
    const payload = {
      format: IMPORT_FORMAT,
      version: IMPORT_VERSION,
      exportedAt: nowIso(),
      markup,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const link = document.createElement('a');
    const safeName =
      markup.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '') || 'markup';
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `${safeName}.gev-markup.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    updateStatus(`Exported ${markup.name}`);
  }

  async function importMarkup(file) {
    const rawText = await file.text();
    let payload = null;
    try {
      payload = JSON.parse(rawText);
    } catch {
      updateStatus('Invalid JSON file.');
      return;
    }
    if (
      payload?.format !== IMPORT_FORMAT ||
      payload?.version !== IMPORT_VERSION
    ) {
      updateStatus('File is not a valid GEV Markup export.');
      return;
    }
    const importedMarkup = payload.markup;
    const importedObjectCount = Array.isArray(importedMarkup?.objects)
      ? importedMarkup.objects.length
      : -1;
    const incoming = normalizeMarkup(importedMarkup);
    if (
      !validateMarkup(incoming) ||
      importedObjectCount < 0 ||
      incoming.objects.length !== importedObjectCount
    ) {
      updateStatus('Imported markup failed validation.');
      return;
    }
    const existing = markups.find((entry) => entry.id === incoming.id);
    const commitImport = async (asCopy) => {
      if (asCopy) {
        incoming.id = uuid();
        incoming.createdAt = nowIso();
        incoming.updatedAt = nowIso();
      }
      await saveMarkup(incoming);
      currentMarkupId = incoming.id;
      undoStacks.set(incoming.id, []);
      renderSavedMarkups();
      renderMap();
      refreshLayerPanel();
      closeAllSheets();
      updateStatus(`Imported ${incoming.name}`);
      enterMarkupMode({ markupId: incoming.id, openCreateIfEmpty: false });
    };
    if (existing) {
      showConfirm({
        title: `Import "${incoming.name}" as a new copy?`,
        message: `A markup named "${existing.name}" already exists with the same saved ID.`,
        confirmLabel: 'IMPORT COPY',
        confirmClassName: 'scene-btn',
        onConfirm: async () => {
          await commitImport(true);
        },
      });
      return;
    }
    await commitImport(false);
  }

  async function submitMarkupMetadata() {
    const name = sanitizeText(metadataNameInput.value);
    if (!name) {
      updateStatus('Markup name is required.');
      metadataNameInput.focus();
      return;
    }
    const description = sanitizeText(metadataDescriptionInput.value);
    if (metadataMode === 'edit' && metadataTargetMarkupId) {
      const markup = markups.find(
        (entry) => entry.id === metadataTargetMarkupId,
      );
      if (!markup) return;
      markup.name = name;
      markup.description = description;
      markup.visible = true;
      await saveMarkup(markup);
      renderSavedMarkups();
      renderMap();
      refreshLayerPanel();
      closeSheet('metadata');
      syncActiveMarkupLabel();
      showSavedFeedback();
      return;
    }
    const markup = normalizeMarkup({
      id: uuid(),
      name,
      description,
      visible: true,
      objects: [],
    });
    await saveMarkup(markup);
    currentMarkupId = markup.id;
    undoStacks.set(markup.id, []);
    renderSavedMarkups();
    renderMap();
    refreshLayerPanel();
    closeSheet('metadata');
    enterMarkupMode({ markupId: markup.id, openCreateIfEmpty: false });
    showSavedFeedback(`Created ${markup.name}`);
  }

  async function submitObjectSheet() {
    const context = pendingObjectContext;
    if (!context) return;
    const categoryOptions =
      context.kind === 'line' ? ROUTE_TYPE_OPTIONS : DEFAULT_CATEGORIES;
    let category = normalizeCategory(
      objectCategorySelect.value,
      categoryOptions,
    );
    if (sanitizeText(objectCategorySelect.value).toLowerCase() === 'other') {
      const customCategory = sanitizeText(objectCustomInput.value);
      if (customCategory) category = customCategory;
    }
    const title = sanitizeText(objectNameInput.value);
    if (!title) {
      updateStatus('A name is required.');
      objectNameInput.focus();
      return;
    }
    const payload = {
      id: context.objectId || uuid(),
      type: context.kind,
      visible: true,
      category,
      title,
      description: sanitizeText(objectDescriptionInput.value),
      notes: sanitizeText(objectNotesInput.value),
      geometry:
        context.geometry ||
        findMarkupObject(context.markupId, context.objectId).object?.geometry,
    };
    const object = ensureMarkupObject(payload);
    if (!object) {
      updateStatus('Markup object failed validation.');
      return;
    }
    if (context.mode === 'edit' && context.markupId && context.objectId) {
      await updateObject(context.markupId, context.objectId, (entry) => {
        entry.title = object.title;
        entry.category = object.category;
        entry.description = object.description;
        entry.notes = object.notes;
        entry.visible = object.visible;
      });
      returnToMarkupMap();
      return;
    }
    await addObjectToMarkup(
      context.markupId || currentMarkupId,
      object,
      `✓ Saved`,
    );
    clearTransientGeometry();
    returnToMarkupMap();
  }

  async function handleMarkupAction(action, markupId) {
    const markup = markups.find((entry) => entry.id === markupId);
    if (!markup) return;
    if (action === 'use') {
      currentMarkupId = markup.id;
      enterMarkupMode({ markupId: markup.id, openCreateIfEmpty: false });
      closeSheet('manager');
      return;
    }
    if (action === 'toggle-visibility') {
      markup.visible = markup.visible === false;
      await saveMarkup(markup);
      renderSavedMarkups();
      renderMap();
      refreshLayerPanel();
      showSavedFeedback();
      return;
    }
    if (action === 'rename') {
      openMarkupMetadataSheet({ mode: 'edit', markupId: markup.id });
      return;
    }
    if (action === 'export') {
      exportMarkup(markup.id);
      return;
    }
    if (action === 'delete') {
      showConfirm({
        title: `Delete "${markup.name}"?`,
        message: 'This markup and all of its saved objects will be removed.',
        onConfirm: async () => {
          const removedActive = currentMarkupId === markup.id;
          await removeMarkup(markup.id);
          if (removedActive) currentMarkupId = activeMarkupFallback();
          renderSavedMarkups();
          renderMap();
          refreshLayerPanel();
          if (!markups.length) hideObjectCard();
        },
      });
    }
  }

  async function undo() {
    if (editing && activeTool) {
      if (
        activeTool === 'line' ||
        activeTool === 'polygon' ||
        (activeTool === 'circle' && circleCenter)
      ) {
        undoDrawingPoint();
        return;
      }
    }
    const markup = currentMarkup();
    if (!markup) return;
    const stack = currentUndoStack();
    const action = stack.pop();
    if (!action) {
      updateStatus('Nothing to undo.');
      return;
    }
    if (action.type === 'add') {
      const index = markup.objects.findIndex(
        (entry) => entry.id === action.object.id,
      );
      if (index >= 0) markup.objects.splice(index, 1);
    } else if (action.type === 'remove') {
      const restored = ensureMarkupObject(action.object);
      if (restored) markup.objects.push(restored);
    } else if (action.type === 'update') {
      const index = markup.objects.findIndex(
        (entry) => entry.id === action.objectId,
      );
      const restored = ensureMarkupObject(action.before);
      if (index >= 0 && restored) markup.objects[index] = restored;
    }
    await saveMarkup(markup);
    renderMap();
    renderSavedMarkups();
    refreshLayerPanel();
    showSavedFeedback('✓ Saved');
  }

  function syncPanelState() {
    isMobileLayout = Boolean(layoutMedia?.matches);
    const mobileMarkupOpen = isMobileMarkupPresentationActive();
    if (mobileMarkupOpen && !editing) {
      enterMarkupMode();
    } else {
      syncMobilePresentation();
      bindEditingHandler();
    }
  }

  try {
    db = await createMarkupDb();
    storageEnabled = true;
    markups = (await dbReadAll(db)).map(normalizeMarkup);
  } catch (error) {
    db = null;
    storageEnabled = false;
    markups = [];
    const reason = error?.message || String(error);
    updateStatus(`Markup storage unavailable: ${reason}`);
    try {
      showToast(
        'Markup storage unavailable; running in-memory for this session.',
      );
    } catch {
      /* ignored */
    }
  }

  populateSelectOptions(objectCategorySelect, DEFAULT_CATEGORIES);
  renderMap();
  renderSavedMarkups();
  syncLayersApi();
  if (storageEnabled) updateStatus('Ready');
  syncActiveMarkupLabel();
  syncToolButtons();
  syncRouteModeButtons();
  syncMobilePresentation();

  const selectedEntityRemover = viewer.selectedEntityChanged.addEventListener(
    () => {
      syncSelectedEntityCard();
    },
  );

  function listen(target, type, handler) {
    if (!target) return;
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  }

  listen(newBtn, 'click', () => openMarkupMetadataSheet({ mode: 'create' }));
  listen(importBtn, 'click', () => importFile?.click());
  listen(saveBtn, 'click', () => {
    if (!currentMarkupId) return;
    openMarkupMetadataSheet({ mode: 'edit', markupId: currentMarkupId });
  });
  listen(exitBtn, 'click', () => {
    leaveMarkupMode({ collapseMobilePanel: isMobileLayout });
  });
  listen(undoBtn, 'click', () => {
    void undo();
  });
  listen(importFile, 'change', () => {
    const file = importFile?.files?.[0];
    if (!file) return;
    void (async () => {
      await importMarkup(file);
      if (importFile) importFile.value = '';
    })();
  });
  listen(activeControl, 'click', () => {
    if (managerSheet?.hidden) openSheet('manager');
    else closeSheet('manager');
  });
  listen(managerCloseBtn, 'click', () => closeSheet('manager'));
  listen(managerNewBtn, 'click', () =>
    openMarkupMetadataSheet({ mode: 'create' }),
  );
  listen(managerImportBtn, 'click', () => importFile?.click());
  listen(metadataCancelBtn, 'click', () => closeSheet('metadata'));
  listen(metadataSheet, 'submit', (event) => {
    event.preventDefault();
    void submitMarkupMetadata();
  });
  listen(objectCategorySelect, 'change', () => {
    if (sanitizeText(objectCategorySelect.value).toLowerCase() === 'other') {
      objectDetailsExpanded = true;
      objectMoreFields.hidden = false;
      objectMoreBtn.textContent = 'LESS DETAILS';
    }
    syncObjectCustomField();
  });
  listen(objectMoreBtn, 'click', () => {
    objectDetailsExpanded = !objectDetailsExpanded;
    objectMoreFields.hidden = !objectDetailsExpanded;
    objectMoreBtn.textContent = objectDetailsExpanded
      ? 'LESS DETAILS'
      : 'MORE DETAILS';
    syncObjectCustomField();
  });
  listen(objectMinimizeBtn, 'click', () => {
    if (pendingObjectContext?.mode !== 'create') return;
    objectSheetMinimized = !objectSheetMinimized;
    syncObjectSheetPresentation();
  });
  listen(objectCancelBtn, 'click', () => {
    if (pendingObjectContext?.mode === 'create') clearTransientGeometry();
    returnToMarkupMap();
  });
  listen(objectSheet, 'submit', (event) => {
    event.preventDefault();
    void submitObjectSheet();
  });
  listen(confirmCancelBtn, 'click', () => closeSheet('confirm'));
  listen(confirmSubmitBtn, 'click', () => {
    const action = confirmAction;
    closeSheet('confirm', { restoreConfirmSheet: false });
    void action?.();
  });
  listen(objectEditBtn, 'click', () => {
    if (!selectedObjectRef) return;
    const { markup, object } = findMarkupObject(
      selectedObjectRef.markupId,
      selectedObjectRef.objectId,
    );
    if (!markup || !object) return;
    openObjectSheet({
      mode: 'edit',
      kind: object.type,
      markupId: markup.id,
      objectId: object.id,
    });
  });
  listen(objectDeleteSecondaryBtn, 'click', () => {
    if (pendingObjectContext?.mode !== 'edit') return;
    const { markupId, objectId } = pendingObjectContext;
    const { object } = findMarkupObject(markupId, objectId);
    if (!object) return;
    showConfirm({
      title: `Delete "${object.title || object.category || 'markup object'}"?`,
      message: 'This object will be removed from the markup.',
      preserveSheet: 'object',
      onConfirm: async () => {
        await removeObjectFromMarkup(markupId, objectId);
        returnToMarkupMap();
      },
    });
  });
  listen(objectHideBtn, 'click', () => {
    if (!selectedObjectRef) return;
    const { markupId, objectId } = selectedObjectRef;
    const { object } = findMarkupObject(markupId, objectId);
    if (!object) return;
    void updateObject(markupId, objectId, (entry) => {
      entry.visible = entry.visible === false;
    }).then(() => {
      const updated = findMarkupObject(markupId, objectId).object;
      if (updated?.visible === false) {
        viewer.selectedEntity = null;
      } else {
        setObjectCard(markupId, objectId);
      }
    });
  });
  listen(objectDeleteBtn, 'click', () => {
    if (!selectedObjectRef) return;
    const { markupId, objectId } = selectedObjectRef;
    const { object } = findMarkupObject(markupId, objectId);
    if (!object) return;
    showConfirm({
      title: `Delete "${object.title || object.category || 'markup object'}"?`,
      message: 'This object will be removed from the markup.',
      onConfirm: async () => {
        await removeObjectFromMarkup(markupId, objectId);
        viewer.selectedEntity = null;
      },
    });
  });
  listen(mobileDoneBtn, 'click', () => {
    leaveMarkupMode({ collapseMobilePanel: true });
  });
  listen(mobileUndoBtn, 'click', () => {
    void undo();
  });
  listen(statusUndoBtn, 'click', () => undoDrawingPoint());
  listen(statusRedrawBtn, 'click', () => redrawRoute());
  listen(statusFinishBtn, 'click', () => {
    void finishActiveGeometry();
  });
  listen(statusCancelBtn, 'click', () => cancelDrawing());

  for (const button of toolButtons) {
    listen(button, 'click', () => {
      if (!editing) return;
      const next = button.dataset.markupTool;
      const tool = next === activeTool ? null : next;
      selectTool(tool);
    });
  }

  for (const button of routeModeButtons) {
    listen(button, 'click', () => {
      if (routeMode === button.dataset.routeMode) return;
      routeMode = button.dataset.routeMode === 'points' ? 'points' : 'free';
      clearTransientGeometry();
      syncRouteModeButtons();
      syncStatusCopy();
    });
  }

  const onMarkupListClick = (event) => {
    const button = event.target.closest?.(
      'button[data-action][data-markup-id]',
    );
    if (!button) return;
    void handleMarkupAction(button.dataset.action, button.dataset.markupId);
  };
  listen(savedList, 'click', onMarkupListClick);
  listen(managerList, 'click', onMarkupListClick);

  if (layoutMedia) {
    const onLayoutChange = (event) => {
      isMobileLayout = Boolean(event.matches);
      if (
        !isMobileLayout &&
        body?.dataset?.mobilePanel === 'markup' &&
        editing
      ) {
        closeAllSheets();
      }
      syncPanelState();
    };
    layoutMedia.addEventListener('change', onLayoutChange);
    listeners.push(() =>
      layoutMedia.removeEventListener('change', onLayoutChange),
    );
  }

  panelObserver = new MutationObserver(() => syncPanelState());
  panelObserver.observe(panel, {
    attributes: true,
    attributeFilter: ['class'],
  });
  bodyObserver = new MutationObserver(() => syncPanelState());
  bodyObserver.observe(body, {
    attributes: true,
    attributeFilter: ['data-mobile-panel'],
  });
  listeners.push(() => panelObserver?.disconnect());
  listeners.push(() => bodyObserver?.disconnect());

  syncPanelState();

  window.__gevMarkups = {
    list: () => structuredClone(markups),
    setVisible: (id, visible) =>
      window.__gevMarkupsLayerApi?.setVisible(id, visible),
    refresh: () => {
      renderMap();
      renderSavedMarkups();
      refreshLayerPanel();
    },
  };

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const remove of listeners.splice(0)) remove();
      try {
        selectedEntityRemover?.();
      } catch {
        /* ignored */
      }
      if (editHandler) {
        editHandler.destroy();
        editHandler = null;
      }
      editKeyRemover?.();
      editKeyRemover = null;
      if (lease) {
        releasePointer(lease);
        lease = null;
      }
      restoreCameraControls();
      if (savedSingleClick) {
        viewer.screenSpaceEventHandler.setInputAction(
          savedSingleClick,
          Cesium.ScreenSpaceEventType.LEFT_CLICK,
        );
        savedSingleClick = null;
      }
      if (savedDoubleClick) {
        viewer.screenSpaceEventHandler.setInputAction(
          savedDoubleClick,
          Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK,
        );
        savedDoubleClick = null;
      }
      if (statusResetTimer) clearTimeout(statusResetTimer);
      hideObjectCard();
      closeAllSheets();
      clearPreviewEntities();
      viewer.dataSources.remove(dataSource, true);
      if (window.__gevMarkupsLayerApi) delete window.__gevMarkupsLayerApi;
      if (window.__gevMarkups) delete window.__gevMarkups;
    },
  };
}
