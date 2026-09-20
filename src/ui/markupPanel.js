import * as Cesium from 'cesium';
import { pickWorldFromScreen } from '../annotations/annotationResolver.js';
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

const TOOL_HINTS = Object.freeze({
  none: 'Select a tool to start editing.',
  marker: 'Tap the map to place a marker.',
  line: 'Tap points to draw a line. Double-click or Enter to finish.',
  polygon: 'Tap points to draw an area. 3 points minimum.',
  circle: 'Tap center, then tap again to set radius.',
  delete: 'Tap a markup object to delete it.',
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

function normalizeCategory(input) {
  const category = sanitizeText(input);
  if (!category) return 'Other';
  const known = DEFAULT_CATEGORIES.find(
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

function normalizeMarkup(raw) {
  const timestamp = nowIso();
  const objects = Array.isArray(raw?.objects)
    ? raw.objects.filter(validateMarkupObject)
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

function ensureMarkupObject(raw) {
  const timestamp = nowIso();
  const object = {
    id: sanitizeText(raw?.id) || uuid(),
    type: raw?.type,
    category: normalizeCategory(raw?.category),
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

export async function initMarkupPanel({ viewer, showToast = () => {} } = {}) {
  const panel = document.getElementById('scene-panel');
  const home = document.getElementById('markup-home');
  const editor = document.getElementById('markup-editor');
  const savedList = document.getElementById('markup-saved-list');
  const emptyState = document.getElementById('markup-empty-state');
  const status = document.getElementById('markup-status');
  const hint = document.getElementById('markup-tool-hint');
  const newBtn = document.getElementById('markup-new-btn');
  const saveBtn = document.getElementById('markup-save-btn');
  const exitBtn = document.getElementById('markup-exit-btn');
  const undoBtn = document.getElementById('markup-undo-btn');
  const importBtn = document.getElementById('markup-import-btn');
  const importFile = document.getElementById('markup-import-file');
  const markerCard = document.getElementById('markup-marker-card');
  const markerCardTitle = document.getElementById('markup-marker-card-title');
  const markerCardBody = document.getElementById('markup-marker-card-body');
  const markerEditBtn = document.getElementById('markup-marker-edit-btn');
  const markerCloseBtn = document.getElementById('markup-marker-close-btn');
  const markerMinBtn = document.getElementById('markup-marker-minimize-btn');
  const markerCardBodyNode = document.getElementById('markup-marker-card-body');
  const markerForm = document.getElementById('markup-marker-form');
  const markerTitleInput = document.getElementById('markup-marker-title');
  const markerCategorySelect = document.getElementById('markup-marker-category');
  const markerCustomWrap = document.getElementById('markup-marker-custom-wrap');
  const markerCustomInput = document.getElementById(
    'markup-marker-custom-category',
  );
  const markerDescriptionInput = document.getElementById(
    'markup-marker-description',
  );
  const markerNotesInput = document.getElementById('markup-marker-notes');
  const markerCancelBtn = document.getElementById('markup-marker-cancel-btn');
  const markerSubmitBtn = document.getElementById('markup-marker-submit-btn');

  if (!viewer || !panel || !savedList || !newBtn) return null;

  const toolButtons = [
    ...document.querySelectorAll('.markup-tool-btn[data-markup-tool]'),
  ];
  const dataSource = new Cesium.CustomDataSource('gev-markups');
  await viewer.dataSources.add(dataSource);

  let db = null;
  let storageEnabled = false;
  let destroyed = false;
  let markups = [];
  let currentMarkupId = null;
  let editing = false;
  let activeTool = null;
  let drawPoints = [];
  let circleCenter = null;
  let lease = null;
  let editHandler = null;
  let savedSingleClick = null;
  let savedDoubleClick = null;
  let editKeyRemover = null;
  let selectedMarkerObjectId = null;
  let selectedMarkerMarkupId = null;
  let pendingMarkerPoint = null;
  let pendingMarkerEditTarget = null;
  let pathPreviewEntity = null;
  let polygonPreviewEntity = null;
  let drawingVertexEntities = [];
  const undoStacks = new Map();
  const listeners = [];

  const updateStatus = (text) => {
    if (status) status.textContent = text;
  };

  const requestRender = () => {
    try {
      viewer.scene.requestRender();
    } catch {
      /* ignored */
    }
  };

  const currentMarkup = () =>
    markups.find((entry) => entry.id === currentMarkupId) || null;
  const currentUndoStack = () => {
    if (!currentMarkupId) return [];
    if (!undoStacks.has(currentMarkupId)) undoStacks.set(currentMarkupId, []);
    return undoStacks.get(currentMarkupId);
  };

  const emitLayerChange = () => {
    document.dispatchEvent(new CustomEvent('gev:markup-layer-change'));
  };

  const saveMarkup = async (markup) => {
    markup.updatedAt = nowIso();
    if (db) await dbPut(db, markup);
    const index = markups.findIndex((entry) => entry.id === markup.id);
    if (index >= 0) markups[index] = structuredClone(markup);
    else markups.push(structuredClone(markup));
    emitLayerChange();
  };

  const removeMarkup = async (id) => {
    if (db) await dbDelete(db, id);
    markups = markups.filter((entry) => entry.id !== id);
    undoStacks.delete(id);
    emitLayerChange();
  };

  const refreshLayerPanel = () => {
    try {
      window.__gevLayerPanelRefresh?.();
    } catch {
      /* ignored */
    }
  };

  const renderMap = () => {
    dataSource.entities.removeAll();
    pathPreviewEntity = null;
    polygonPreviewEntity = null;
    drawingVertexEntities = [];
    for (const markup of markups) {
      if (markup.visible === false) continue;
      for (const object of markup.objects || []) {
        if (!validateMarkupObject(object)) continue;
        const entityBase = {
          properties: {
            gevMarkupId: markup.id,
            gevMarkupObjectId: object.id,
            gevMarkupType: object.type,
            gevMarkupCategory: object.category,
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
          const points = object.geometry.points || [];
          dataSource.entities.add({
            ...entityBase,
            id: `markup-${markup.id}-${object.id}`,
            polygon: {
              hierarchy: new Cesium.PolygonHierarchy(toCesiumPositions(points)),
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
    if (
      editing &&
      (activeTool === 'line' || activeTool === 'polygon') &&
      drawPoints.length
    ) {
      updateDrawPreview();
    }
    requestRender();
  };

  const setMarkerCard = (object, markupId) => {
    if (!markerCard || !markerCardBody || !markerCardTitle) return;
    if (!object) {
      markerCard.hidden = true;
      markerCard.classList.remove('is-minimized');
      selectedMarkerMarkupId = null;
      selectedMarkerObjectId = null;
      return;
    }
    selectedMarkerMarkupId = markupId;
    selectedMarkerObjectId = object.id;
    markerCard.hidden = false;
    markerCard.classList.remove('is-minimized');
    markerCardTitle.textContent = object.title || 'Untitled marker';
    markerCardBody.innerHTML = '';
    const rows = [
      ['Category', object.category || 'Other'],
      ['Description', object.description || '—'],
      ['Notes', object.notes || '—'],
    ];
    for (const [label, value] of rows) {
      const row = document.createElement('div');
      row.className = 'markup-marker-row';
      const key = document.createElement('strong');
      key.textContent = `${label}: `;
      const content = document.createElement('span');
      content.textContent = value;
      row.appendChild(key);
      row.appendChild(content);
      markerCardBody.appendChild(row);
    }
    markerEditBtn.hidden = !(
      editing && selectedMarkerMarkupId === currentMarkupId
    );
  };

  const selectedMarkerCategoryOption = () =>
    sanitizeText(markerCategorySelect?.value || 'Other') || 'Other';

  const syncMarkerCustomCategoryVisibility = () => {
    const isOther =
      selectedMarkerCategoryOption().toLowerCase() === 'other' ||
      !DEFAULT_CATEGORIES.some(
        (entry) =>
          entry.toLowerCase() === selectedMarkerCategoryOption().toLowerCase(),
      );
    if (markerCustomWrap) markerCustomWrap.hidden = !isOther;
  };

  const hideMarkerForm = () => {
    pendingMarkerPoint = null;
    pendingMarkerEditTarget = null;
    if (markerForm) markerForm.hidden = true;
    if (markerCategorySelect) markerCategorySelect.value = 'Other';
    if (markerCustomInput) markerCustomInput.value = '';
    if (markerTitleInput) markerTitleInput.value = '';
    if (markerDescriptionInput) markerDescriptionInput.value = '';
    if (markerNotesInput) markerNotesInput.value = '';
    if (markerSubmitBtn) markerSubmitBtn.textContent = 'ADD MARKER';
    syncMarkerCustomCategoryVisibility();
  };

  const markerDetailsFromForm = () => {
    const selectedCategory = selectedMarkerCategoryOption();
    let category = normalizeCategory(selectedCategory);
    if (selectedCategory.toLowerCase() === 'other') {
      const customCategory = sanitizeText(markerCustomInput?.value);
      if (customCategory) category = customCategory;
    }
    return {
      title: sanitizeText(markerTitleInput?.value),
      category,
      description: sanitizeText(markerDescriptionInput?.value),
      notes: sanitizeText(markerNotesInput?.value),
    };
  };

  const showMarkerForm = ({
    point = null,
    seed = null,
    submitLabel,
    editTarget = null,
  } = {}) => {
    if (!markerForm) return;
    pendingMarkerPoint = point || null;
    pendingMarkerEditTarget = editTarget || null;
    markerForm.hidden = false;
    if (markerTitleInput) markerTitleInput.value = seed?.title || '';
    const seedCategory = sanitizeText(seed?.category);
    const knownCategory = DEFAULT_CATEGORIES.find(
      (entry) => entry.toLowerCase() === seedCategory.toLowerCase(),
    );
    if (markerCategorySelect) markerCategorySelect.value = knownCategory || 'Other';
    if (markerCustomInput)
      markerCustomInput.value = knownCategory ? '' : seedCategory || '';
    if (markerDescriptionInput)
      markerDescriptionInput.value = seed?.description || '';
    if (markerNotesInput) markerNotesInput.value = seed?.notes || '';
    if (markerSubmitBtn) markerSubmitBtn.textContent = submitLabel || 'ADD MARKER';
    syncMarkerCustomCategoryVisibility();
    markerTitleInput?.focus();
  };

  const clearDrawingPreview = () => {
    if (pathPreviewEntity) {
      dataSource.entities.remove(pathPreviewEntity);
      pathPreviewEntity = null;
    }
    if (polygonPreviewEntity) {
      dataSource.entities.remove(polygonPreviewEntity);
      polygonPreviewEntity = null;
    }
    if (drawingVertexEntities.length) {
      for (const entity of drawingVertexEntities) dataSource.entities.remove(entity);
      drawingVertexEntities = [];
    }
  };

  const updateDrawPreview = () => {
    if (activeTool !== 'line' && activeTool !== 'polygon') {
      clearDrawingPreview();
      return;
    }
    if (!drawPoints.length) {
      clearDrawingPreview();
      return;
    }
    if (!pathPreviewEntity) {
      pathPreviewEntity = dataSource.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(
            () => toCesiumPositions(drawPoints),
            false,
          ),
          width: 4,
          clampToGround: true,
          material: Cesium.Color.CYAN.withAlpha(0.9),
        },
      });
    }
    if (drawingVertexEntities.length) {
      for (const entity of drawingVertexEntities) dataSource.entities.remove(entity);
      drawingVertexEntities = [];
    }
    for (const point of drawPoints) {
      drawingVertexEntities.push(
        dataSource.entities.add({
          position: Cesium.Cartesian3.fromDegrees(
            point.lon,
            point.lat,
            point.height || 0,
          ),
          point: {
            pixelSize: 9,
            color: Cesium.Color.fromCssColorString('#00d4ff').withAlpha(0.95),
            outlineColor: Cesium.Color.BLACK.withAlpha(0.75),
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        }),
      );
    }
    if (activeTool === 'polygon' && drawPoints.length >= 3) {
      if (!polygonPreviewEntity) {
        polygonPreviewEntity = dataSource.entities.add({
          polygon: {
            hierarchy: new Cesium.CallbackProperty(
              () => new Cesium.PolygonHierarchy(toCesiumPositions(drawPoints)),
              false,
            ),
            material: Cesium.Color.CYAN.withAlpha(0.26),
            outline: true,
            outlineColor: Cesium.Color.CYAN.withAlpha(0.92),
            perPositionHeight: false,
          },
        });
      }
    } else if (polygonPreviewEntity) {
      dataSource.entities.remove(polygonPreviewEntity);
      polygonPreviewEntity = null;
    }
    requestRender();
  };

  const findMarkupObject = (markupId, objectId) => {
    const markup = markups.find((entry) => entry.id === markupId);
    const object = markup?.objects?.find((entry) => entry.id === objectId);
    return { markup, object };
  };

  const onSelectedEntityChanged = () => {
    const entity = viewer.selectedEntity;
    const markupId = valueFromEntityProperty(entity, 'gevMarkupId');
    const objectId = valueFromEntityProperty(entity, 'gevMarkupObjectId');
    const type = valueFromEntityProperty(entity, 'gevMarkupType');
    if (!markupId || !objectId || type !== 'marker') {
      setMarkerCard(null);
      return;
    }
    const { object } = findMarkupObject(markupId, objectId);
    if (!object) {
      setMarkerCard(null);
      return;
    }
    setMarkerCard(object, markupId);
  };

  const selectTool = (tool) => {
    activeTool = tool || null;
    drawPoints = [];
    circleCenter = null;
    clearDrawingPreview();
    if (activeTool !== 'marker') hideMarkerForm();
    for (const button of toolButtons) {
      const on = button.dataset.markupTool === activeTool;
      button.classList.toggle('active', on);
      button.setAttribute('aria-pressed', String(on));
    }
    hint.textContent = TOOL_HINTS[activeTool || 'none'];
    bindEditingHandler();
  };

  const leaveEditMode = () => {
    editing = false;
    selectTool(null);
    hideMarkerForm();
    clearDrawingPreview();
    if (editor) editor.hidden = true;
    if (home) home.hidden = false;
    panel.classList.remove('markup-editing');
    setMarkerCard(null);
    renderSavedMarkups();
  };

  const setEditMode = (enabled) => {
    editing = Boolean(enabled);
    panel.classList.toggle('markup-editing', editing);
    if (editor) editor.hidden = !editing;
    if (home) home.hidden = editing;
    if (!editing) {
      selectTool(null);
      hideMarkerForm();
      clearDrawingPreview();
    }
    markerEditBtn.hidden = !editing;
  };

  async function addObjectToCurrent(object, message = 'Markup object added.') {
    const markup = currentMarkup();
    if (!markup) return;
    markup.objects.push(object);
    currentUndoStack().push({ type: 'add', object: structuredClone(object) });
    await saveMarkup(markup);
    renderMap();
    renderSavedMarkups();
    updateStatus(message);
  }

  async function removeObjectFromCurrent(
    objectId,
    message = 'Markup object removed.',
  ) {
    const markup = currentMarkup();
    if (!markup) return;
    const index = markup.objects.findIndex((entry) => entry.id === objectId);
    if (index < 0) return;
    const [removed] = markup.objects.splice(index, 1);
    currentUndoStack().push({
      type: 'remove',
      object: structuredClone(removed),
    });
    await saveMarkup(markup);
    renderMap();
    renderSavedMarkups();
    if (selectedMarkerObjectId === objectId) setMarkerCard(null);
    updateStatus(message);
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
    if (!editing || !activeTool) return;
    lease = claimPointer(MARKUP_POINTER_OWNER);
    if (!lease) {
      updateStatus(`${pointerOwner()} is using the pointer — close it first.`);
      activeTool = null;
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

    const worldAt = (position) => {
      const canvas = viewer.scene.canvas;
      const width = canvas.clientWidth || canvas.width || 1;
      const height = canvas.clientHeight || canvas.height || 1;
      return pickWorldFromScreen(
        viewer,
        position.x / width,
        position.y / height,
      );
    };

    const finishPath = async () => {
      if (!editing || !activeTool) return;
      if (activeTool === 'line' && drawPoints.length >= 2) {
        const object = ensureMarkupObject({
          id: uuid(),
          type: 'line',
          category: 'Other',
          title: 'Line',
          geometry: { points: structuredClone(drawPoints) },
        });
        if (object) await addObjectToCurrent(object, 'Line saved to markup.');
      }
      if (activeTool === 'polygon' && drawPoints.length >= 3) {
        const object = ensureMarkupObject({
          id: uuid(),
          type: 'polygon',
          category: 'Other',
          title: 'Area',
          geometry: { points: structuredClone(drawPoints) },
        });
        if (object) await addObjectToCurrent(object, 'Area saved to markup.');
      }
      drawPoints = [];
      clearDrawingPreview();
      hint.textContent = TOOL_HINTS[activeTool] || TOOL_HINTS.none;
    };

    editHandler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    editHandler.setInputAction(async (event) => {
      if (markerForm && !markerForm.hidden) return;
      const world = worldAt(event.position);
      if (!world) return;
      const coordinate = coordFromWorld(world);
      if (!coordinate) return;
      if (activeTool === 'marker') {
        showMarkerForm({ point: coordinate, submitLabel: 'ADD MARKER' });
        updateStatus('Enter marker details, then add or cancel.');
        return;
      }
      if (activeTool === 'line' || activeTool === 'polygon') {
        drawPoints.push(coordinate);
        updateDrawPreview();
        hint.textContent = `${TOOL_HINTS[activeTool]} (${drawPoints.length} point${drawPoints.length === 1 ? '' : 's'})`;
        return;
      }
      if (activeTool === 'circle') {
        if (!circleCenter) {
          circleCenter = coordinate;
          hint.textContent = 'Tap again to set radius.';
          return;
        }
        const radiusMeters = Math.max(
          1,
          distanceMeters(circleCenter, coordinate),
        );
        const object = ensureMarkupObject({
          id: uuid(),
          type: 'circle',
          category: 'Other',
          title: 'Radius',
          geometry: { center: circleCenter, radiusMeters },
        });
        circleCenter = null;
        hint.textContent = TOOL_HINTS.circle;
        if (object) await addObjectToCurrent(object, 'Radius saved to markup.');
        return;
      }
      if (activeTool === 'delete') {
        const pick = viewer.scene.pick(event.position);
        const markupId = valueFromEntityProperty(pick?.id, 'gevMarkupId');
        const objectId = valueFromEntityProperty(pick?.id, 'gevMarkupObjectId');
        if (!markupId || !objectId || markupId !== currentMarkupId) return;
        await removeObjectFromCurrent(objectId);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    editHandler.setInputAction(async () => {
      if (activeTool === 'line' || activeTool === 'polygon') await finishPath();
    }, Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);

    const onKey = async (event) => {
      if (!editing || !activeTool) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        drawPoints = [];
        circleCenter = null;
        clearDrawingPreview();
        if (activeTool === 'marker') hideMarkerForm();
        hint.textContent = TOOL_HINTS[activeTool] || TOOL_HINTS.none;
      }
      if (
        event.key === 'Enter' &&
        (activeTool === 'line' || activeTool === 'polygon')
      ) {
        event.preventDefault();
        await finishPath();
      }
    };
    document.addEventListener('keydown', onKey, true);
    editKeyRemover = () => document.removeEventListener('keydown', onKey, true);
  }

  function renderSavedMarkups() {
    if (!savedList) return;
    savedList.textContent = '';
    const sorted = markups.slice().sort((a, b) => a.name.localeCompare(b.name));
    emptyState.hidden = sorted.length > 0;
    for (const markup of sorted) {
      const row = document.createElement('div');
      row.className = 'markup-row';

      const top = document.createElement('div');
      top.className = 'markup-row-top';

      const title = document.createElement('div');
      title.className = 'markup-row-title';
      title.textContent = markup.name;

      const actions = document.createElement('div');
      actions.className = 'markup-row-actions';

      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'scene-btn';
      open.textContent = 'OPEN/EDIT';
      open.addEventListener('click', () => {
        currentMarkupId = markup.id;
        viewer.selectedEntity = null;
        setMarkerCard(null);
        setEditMode(true);
        selectTool(null);
        updateStatus(`Editing ${markup.name}`);
        renderSavedMarkups();
      });

      const visibility = document.createElement('button');
      visibility.type = 'button';
      visibility.className = `scene-btn ${markup.visible !== false ? 'active' : ''}`;
      visibility.textContent = markup.visible !== false ? 'VISIBLE' : 'HIDDEN';
      visibility.addEventListener('click', async () => {
        markup.visible = markup.visible === false;
        await saveMarkup(markup);
        renderMap();
        renderSavedMarkups();
        refreshLayerPanel();
      });

      const more = document.createElement('details');
      more.className = 'markup-row-more';
      const summary = document.createElement('summary');
      summary.textContent = 'MORE';
      more.appendChild(summary);

      const menu = document.createElement('div');
      menu.className = 'markup-row-menu';

      const exportBtn = document.createElement('button');
      exportBtn.type = 'button';
      exportBtn.className = 'scene-btn';
      exportBtn.textContent = 'EXPORT JSON';
      exportBtn.addEventListener('click', () => exportMarkup(markup.id));

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'scene-btn scene-btn-danger';
      deleteBtn.textContent = 'DELETE';
      deleteBtn.addEventListener('click', async () => {
        if (!window.confirm(`Delete markup "${markup.name}"?`)) return;
        if (currentMarkupId === markup.id) {
          currentMarkupId = null;
          leaveEditMode();
        }
        await removeMarkup(markup.id);
        renderMap();
        renderSavedMarkups();
        refreshLayerPanel();
      });

      menu.appendChild(exportBtn);
      menu.appendChild(deleteBtn);
      more.appendChild(menu);

      actions.appendChild(open);
      actions.appendChild(visibility);
      actions.appendChild(more);

      top.appendChild(title);
      top.appendChild(actions);
      row.appendChild(top);

      if (markup.description) {
        const description = document.createElement('div');
        description.className = 'markup-row-description';
        description.textContent = markup.description;
        row.appendChild(description);
      }
      savedList.appendChild(row);
    }
  }

  const createNewMarkup = async () => {
    const name = window.prompt('Markup name *', 'New Markup');
    if (name === null) return;
    const markupName = sanitizeText(name);
    if (!markupName) {
      updateStatus('Markup name is required.');
      return;
    }
    const description = window.prompt('Optional description', '') || '';
    const markup = normalizeMarkup({
      id: uuid(),
      name: markupName,
      description,
      visible: true,
      objects: [],
    });
    await saveMarkup(markup);
    currentMarkupId = markup.id;
    undoStacks.set(markup.id, []);
    viewer.selectedEntity = null;
    setMarkerCard(null);
    setEditMode(true);
    selectTool(null);
    renderSavedMarkups();
    renderMap();
    refreshLayerPanel();
    updateStatus(`Created ${markup.name}`);
  };

  const saveCurrentMarkup = async () => {
    const markup = currentMarkup();
    if (!markup) return;
    const name = window.prompt('Markup name *', markup.name);
    if (name === null) return;
    const markupName = sanitizeText(name);
    if (!markupName) {
      updateStatus('Markup name is required.');
      return;
    }
    const description =
      window.prompt('Optional description', markup.description || '') || '';
    markup.name = markupName;
    markup.description = sanitizeText(description);
    markup.visible = true;
    await saveMarkup(markup);
    renderSavedMarkups();
    renderMap();
    refreshLayerPanel();
    selectTool(null);
    updateStatus(`Saved ${markup.name}`);
  };

  const submitMarkerForm = async () => {
    if (!editing) return;
    const details = markerDetailsFromForm();
    if (!pendingMarkerPoint && !pendingMarkerEditTarget) return;
    if (pendingMarkerEditTarget) {
      const { markupId, objectId } = pendingMarkerEditTarget;
      const { markup, object } = findMarkupObject(markupId, objectId);
      if (!markup || !object || object.type !== 'marker') return;
      object.title = details.title;
      object.category = details.category;
      object.description = details.description;
      object.notes = details.notes;
      object.updatedAt = nowIso();
      await saveMarkup(markup);
      renderMap();
      setMarkerCard(object, markupId);
      hideMarkerForm();
      updateStatus('Marker updated.');
      return;
    }
    if (activeTool !== 'marker') return;
    const object = ensureMarkupObject({
      id: uuid(),
      type: 'marker',
      category: details.category,
      title: details.title,
      description: details.description,
      notes: details.notes,
      geometry: { position: pendingMarkerPoint },
    });
    if (!object) return;
    await addObjectToCurrent(object, 'Marker saved to markup.');
    hideMarkerForm();
  };

  const undo = async () => {
    if (
      editing &&
      (activeTool === 'line' || activeTool === 'polygon') &&
      drawPoints.length
    ) {
      drawPoints.pop();
      updateDrawPreview();
      hint.textContent = drawPoints.length
        ? `${TOOL_HINTS[activeTool]} (${drawPoints.length} point${drawPoints.length === 1 ? '' : 's'})`
        : TOOL_HINTS[activeTool];
      updateStatus('Removed last point.');
      return;
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
      markup.objects.push(action.object);
    }
    await saveMarkup(markup);
    renderMap();
    renderSavedMarkups();
    updateStatus('Undo complete.');
  };

  const importMarkup = async (file) => {
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
    if (
      existing &&
      !window.confirm(
        `Markup "${existing.name}" already exists. Import this file as a new copy?`,
      )
    ) {
      updateStatus('Import cancelled.');
      return;
    }
    if (existing) {
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
    updateStatus(`Imported ${incoming.name}`);
  };

  const exportMarkup = (markupId) => {
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
  };

  const syncLayersApi = () => {
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
  };

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
    showToast(
      'Markup storage unavailable; running in-memory for this session.',
    );
  }
  renderMap();
  renderSavedMarkups();
  syncLayersApi();
  refreshLayerPanel();
  hideMarkerForm();
  if (storageEnabled) updateStatus('Ready');

  const selectedEntityRemover = viewer.selectedEntityChanged.addEventListener(
    onSelectedEntityChanged,
  );

  const listen = (target, type, handler) => {
    if (!target) return;
    target.addEventListener(type, handler);
    listeners.push(() => target.removeEventListener(type, handler));
  };

  listen(newBtn, 'click', () => {
    void createNewMarkup();
  });
  listen(saveBtn, 'click', () => {
    void saveCurrentMarkup();
  });
  listen(exitBtn, 'click', () => {
    leaveEditMode();
    updateStatus('Edit mode closed.');
  });
  listen(undoBtn, 'click', () => {
    void undo();
  });
  listen(markerCategorySelect, 'change', () => {
    syncMarkerCustomCategoryVisibility();
  });
  listen(markerCancelBtn, 'click', () => {
    const wasEditing = Boolean(pendingMarkerEditTarget);
    hideMarkerForm();
    updateStatus(wasEditing ? 'Marker edit cancelled.' : 'Marker creation cancelled.');
  });
  listen(markerForm, 'submit', (event) => {
    event.preventDefault();
    void submitMarkerForm();
  });
  listen(importBtn, 'click', () => importFile?.click());
  listen(importFile, 'change', () => {
    const file = importFile?.files?.[0];
    if (!file) return;
    void (async () => {
      await importMarkup(file);
      if (importFile) importFile.value = '';
    })();
  });

  for (const button of toolButtons) {
    listen(button, 'click', () => {
      if (!editing) return;
      const next = button.dataset.markupTool;
      const tool = next === activeTool ? null : next;
      selectTool(tool);
    });
  }

  listen(markerCloseBtn, 'click', () => {
    viewer.selectedEntity = null;
    setMarkerCard(null);
  });
  listen(markerMinBtn, 'click', () => {
    markerCard?.classList.toggle('is-minimized');
    if (markerCardBodyNode)
      markerCardBodyNode.hidden =
        markerCard?.classList.contains('is-minimized');
  });
  listen(markerEditBtn, 'click', () => {
    if (
      !editing ||
      selectedMarkerMarkupId !== currentMarkupId ||
      !selectedMarkerObjectId
    )
      return;
    const { object } = findMarkupObject(
      selectedMarkerMarkupId,
      selectedMarkerObjectId,
    );
    if (!object || object.type !== 'marker') return;
    showMarkerForm({
      seed: object,
      submitLabel: 'SAVE MARKER',
      editTarget: {
        markupId: selectedMarkerMarkupId,
        objectId: selectedMarkerObjectId,
      },
    });
    updateStatus('Update marker details and save.');
  });

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
      setMarkerCard(null);
      hideMarkerForm();
      clearDrawingPreview();
      viewer.dataSources.remove(dataSource, true);
      if (window.__gevMarkupsLayerApi) delete window.__gevMarkupsLayerApi;
      if (window.__gevMarkups) delete window.__gevMarkups;
    },
  };
}
