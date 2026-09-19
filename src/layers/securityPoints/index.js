import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  CATEGORY_CONFIG,
  CATEGORY_ORDER,
  DEFAULT_CATEGORY_PARAMS,
  LAYER_ID,
  MAX_VIEWPORT_DEGREES,
  REQUEST_DEBOUNCE_MS,
} from './policy.js';

function colorForCategory(category) {
  return Cesium.Color.fromCssColorString(
    CATEGORY_CONFIG[category]?.color || '#9ca3af',
  );
}

export const SECURITY_POINT_MARKER_HEIGHT_M = 1.5;

export function securityPointMarkerPosition(
  record,
  heightM = SECURITY_POINT_MARKER_HEIGHT_M,
) {
  return Cesium.Cartesian3.fromDegrees(
    record.longitude,
    record.latitude,
    heightM,
  );
}

export function securityPointMarkerGraphics(record, { selected = false } = {}) {
  const color = colorForCategory(record.category);
  return {
    pixelSize:
      (CATEGORY_CONFIG[record.category]?.markerSize || 9) + (selected ? 3 : 0),
    color: selected ? Cesium.Color.WHITE : color,
    outlineColor: color.withAlpha(0.95),
    outlineWidth: selected ? 3 : 2,
    heightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
  };
}

function cloneCategoryParams(params = DEFAULT_CATEGORY_PARAMS) {
  return Object.fromEntries(
    CATEGORY_ORDER.map((id) => [id, params[id] !== false]),
  );
}

function selectedCategoryIds(params) {
  return CATEGORY_ORDER.filter((id) => params[id] !== false);
}

function viewportBox(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle(
    viewer.scene.globe.ellipsoid,
  );
  if (!rectangle) return null;
  const south = Cesium.Math.toDegrees(rectangle.south);
  const north = Cesium.Math.toDegrees(rectangle.north);
  const west = Cesium.Math.toDegrees(rectangle.west);
  const east = Cesium.Math.toDegrees(rectangle.east);
  if (
    !Number.isFinite(south + north + west + east) ||
    east <= west ||
    north - south > MAX_VIEWPORT_DEGREES ||
    east - west > MAX_VIEWPORT_DEGREES
  )
    return null;
  return { south, west, north, east };
}

function categoryCounts(records) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((id) => [id, 0]));
  for (const record of records) counts[record.category] += 1;
  return counts;
}

function formatPhone(phone) {
  const value = String(phone || '').trim();
  if (!value) return null;
  return value;
}

function telHref(phone) {
  const digits = String(phone || '').trim();
  if (!digits) return null;
  const href = digits.replace(/[^\d+]/g, '');
  return href ? `tel:${href}` : null;
}

export function countLabelForState(state) {
  if (!state.enabled) return '';
  if (state.loading) return 'Loading';
  switch (state.status) {
    case 'zoom-in':
      return 'Zoom in to view';
    case 'empty':
      return 'No facilities found';
    case 'unavailable':
      return 'Provider unavailable';
    default:
      return `${state.records.length} nearby`;
  }
}

function approximateDistanceM(latA, lonA, latB, lonB) {
  const latitudeScale = 111320;
  const longitudeScale = latitudeScale * Math.cos((latA * Math.PI) / 180);
  return Math.round(
    Math.hypot((latB - latA) * latitudeScale, (lonB - lonA) * longitudeScale),
  );
}

function dispatchSelectionDetail(detail) {
  window.dispatchEvent(
    new CustomEvent('gev:security-point-selected', { detail }),
  );
}

function dispatchSelectionCleared() {
  window.dispatchEvent(new CustomEvent('gev:security-point-cleared'));
}

function dispatchSelectionModel(record, contextDistanceM = null) {
  const google = record.google || null;
  const phone = formatPhone(google?.phone || record.phone);
  dispatchSelectionDetail({
    id: record.id,
    name: google?.name || record.name,
    categoryLabel:
      CATEGORY_CONFIG[record.category]?.cardLabel || 'Security Point',
    typeLabel: google?.primaryType || record.typeLabel,
    address: google?.address || record.address || 'Address not listed',
    phone,
    phoneLabel: 'Listed phone',
    phoneDisplay: phone || 'Phone not listed',
    telHref: phone ? telHref(phone) : null,
    provider: google?.provider || record.provider || null,
    providerHref: google?.providerHref || record.providerHref || null,
    distanceM: Number.isFinite(contextDistanceM) ? contextDistanceM : null,
  });
}

export function statusForSuccessfulSecurityPointsLoad({
  records = [],
  stale = false,
  failedCategories = [],
  primaryProvider = 'google',
} = {}) {
  if (stale) return 'stale';
  if (primaryProvider === 'overpass') return 'fallback';
  if (Array.isArray(failedCategories) && failedCategories.length > 0)
    return 'partial';
  if (!Array.isArray(records) || records.length === 0) return 'empty';
  return 'ready';
}

export function statusForFailedSecurityPointsLoad({
  hasCachedRecords = false,
} = {}) {
  return hasCachedRecords ? 'stale' : 'unavailable';
}

export function securityPointsStatusMessage({
  status = '',
  saturated = false,
} = {}) {
  const messages = [];
  if (status === 'partial')
    messages.push('Google Places returned partial Security Points coverage');
  if (status === 'fallback')
    messages.push('Google Places unavailable — showing OpenStreetMap fallback');
  if (status === 'stale') messages.push('Showing cached Security Points');
  if (saturated)
    messages.push('Coverage limited — zoom in for fewer facilities');
  return messages.join(' · ') || null;
}

export function createSecurityPointsLayer({ services, source }) {
  if (
    typeof source?.fetchViewport !== 'function' ||
    typeof source?.enrichRecord !== 'function'
  )
    throw new TypeError('A Security Points source is required');

  const { floorAltitudeM, cachedGroundFloor } = services.ground;
  const state = {
    viewer: null,
    dataSource: null,
    enabled: false,
    records: [],
    recordById: new Map(),
    selectedId: null,
    selectedContextDistanceM: null,
    params: cloneCategoryParams(),
    timer: null,
    abort: null,
    enrichAbort: null,
    loading: false,
    stale: false,
    saturated: false,
    failedCategories: [],
    primaryProvider: 'google',
    status: 'idle',
    error: null,
    lastUpdate: null,
    lastLoadedKey: '',
    moveEndRemove: null,
    clickHandler: null,
    dismissListener: null,
  };

  function surfaceHeightM(record) {
    return (
      floorAltitudeM(
        null,
        cachedGroundFloor(record?.latitude, record?.longitude),
      ) ?? 0
    );
  }

  function notifyRender(reason = 'security-points-render') {
    services.render.governorRequestRender(reason);
  }

  function setStatus(status, { error = null } = {}) {
    if (state.status === status && state.error === error) return;
    state.status = status;
    state.error = error;
    notifyRender('security-points-status');
  }

  function clearSelection({ clearContext = true } = {}) {
    state.enrichAbort?.abort();
    state.enrichAbort = null;
    state.selectedId = null;
    state.selectedContextDistanceM = null;
    if (clearContext)
      services.context.clearSelectedEntityContextForLayer(LAYER_ID);
    dispatchSelectionCleared();
  }

  function clearRendered() {
    state.dataSource?.entities.removeAll();
    services.context.removeEntityContextsForLayer(LAYER_ID);
  }

  function buildLabelModel(record) {
    const google = record.google || null;
    const details = [
      CATEGORY_CONFIG[record.category]?.cardLabel || 'Security Point',
      google?.address || record.address || 'Address not listed',
      formatPhone(google?.phone || record.phone)
        ? `Listed phone · ${formatPhone(google?.phone || record.phone)}`
        : 'Phone not listed',
    ];
    return {
      title: google?.name || record.name,
      details,
      accent: CATEGORY_CONFIG[record.category]?.color,
      cardStyle: 'tactical',
      selected: true,
      leaderStyle: 'elbow',
      leaderAnimationMs: 360,
      leaderAnimationStartedAt: Date.now(),
      leaderDrawRatio: 0.7,
      anchorRadiusPx: 10,
      anchorRadiusScale: null,
    };
  }

  function renderRecords({ claimSelection = false } = {}) {
    const selectedContext = services.context.getSelectedEntityContext?.();
    if (
      !claimSelection &&
      state.selectedId &&
      selectedContext &&
      selectedContext.id !== state.selectedId
    )
      clearSelection({ clearContext: false });
    clearRendered();
    notifyRender();
    for (const record of state.records) {
      const color = colorForCategory(record.category);
      const height = surfaceHeightM(record);
      const position = securityPointMarkerPosition(record);
      const displayPosition = Cesium.Cartesian3.fromDegrees(
        record.longitude,
        record.latitude,
        height,
      );
      const selected = record.id === state.selectedId;
      const entity = state.dataSource.entities.add({
        id: record.id,
        position,
        polygon: record.footprint
          ? {
              hierarchy: new Cesium.PolygonHierarchy(
                record.footprint.map(([longitude, latitude]) =>
                  Cesium.Cartesian3.fromDegrees(longitude, latitude, height),
                ),
              ),
              material: color.withAlpha(selected ? 0.3 : 0.24),
              outline: true,
              outlineColor: color.withAlpha(selected ? 0.95 : 0.75),
              outlineWidth: selected ? 2 : 1,
              height,
            }
          : undefined,
        point: securityPointMarkerGraphics(record, { selected }),
      });
      entity.gevTrackedId = `security:${record.id}`;
      entity.gevDisplayPosition = () => displayPosition;
      entity.gevLabelModel = buildLabelModel(record);
      services.context.registerEntityContext(entity, {
        id: record.id,
        layerId: LAYER_ID,
        dataSource: state.dataSource,
        layerName: 'Security Points',
        source:
          record.provider === 'OpenStreetMap'
            ? record.google
              ? 'OpenStreetMap + Google Maps Places'
              : 'OpenStreetMap'
            : record.provider || 'Google Maps Places',
        label: record.name,
        latitude: record.latitude,
        longitude: record.longitude,
        properties: {
          category: record.category,
          typeLabel: record.typeLabel,
          address: record.address,
          phone: record.phone,
        },
      });
    }
    const selectedEntity = state.selectedId
      ? state.dataSource.entities.getById(state.selectedId)
      : null;
    if (selectedEntity) services.context.selectEntityContext(selectedEntity);
    else if (state.selectedId) clearSelection();
  }

  function computeContextDistanceM(record) {
    const selected = services.context.getSelectedEntityContext?.();
    if (
      !selected ||
      selected.layerId === LAYER_ID ||
      !Number.isFinite(selected.latitude) ||
      !Number.isFinite(selected.longitude)
    )
      return null;
    return approximateDistanceM(
      selected.latitude,
      selected.longitude,
      record.latitude,
      record.longitude,
    );
  }

  async function enrichSelectedRecord(record) {
    if (!record || record.google || (record.phone && record.address)) return;
    state.enrichAbort?.abort();
    const controller = new AbortController();
    state.enrichAbort = controller;
    try {
      const google = await source.enrichRecord(record, {
        signal: controller.signal,
      });
      if (
        controller.signal.aborted ||
        state.selectedId !== record.id ||
        !state.recordById.has(record.id)
      )
        return;
      if (google) {
        record.google = google;
        dispatchSelectionModel(record, state.selectedContextDistanceM);
        renderRecords();
      }
    } catch (error) {
      if (error?.name !== 'AbortError')
        console.warn('[SecurityPoints] enrich failed', error);
    } finally {
      if (state.enrichAbort === controller) state.enrichAbort = null;
    }
  }

  function selectRecord(id) {
    const record = state.recordById.get(id);
    if (!record || !state.dataSource) return false;
    state.selectedId = id;
    state.selectedContextDistanceM = computeContextDistanceM(record);
    renderRecords({ claimSelection: true });
    dispatchSelectionModel(record, state.selectedContextDistanceM);
    void enrichSelectedRecord(record);
    return true;
  }

  function scheduleLoad() {
    if (!state.enabled) return;
    clearTimeout(state.timer);
    state.timer = setTimeout(() => {
      void loadSecurityPoints();
    }, REQUEST_DEBOUNCE_MS);
  }

  async function loadSecurityPoints() {
    if (!state.enabled || !state.viewer) return;
    const box = viewportBox(state.viewer);
    if (!box || selectedCategoryIds(state.params).length === 0) {
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      state.records = [];
      state.recordById = new Map();
      state.lastLoadedKey = '';
      state.stale = false;
      state.saturated = false;
      state.failedCategories = [];
      state.primaryProvider = 'google';
      clearRendered();
      clearSelection();
      setStatus(
        selectedCategoryIds(state.params).length === 0 ? 'empty' : 'zoom-in',
      );
      return;
    }
    const requestKey = JSON.stringify({ box, params: state.params });
    if (requestKey === state.lastLoadedKey && !state.loading) return;
    state.abort?.abort();
    const controller = new AbortController();
    state.abort = controller;
    state.loading = true;
    setStatus('loading');
    try {
      const applyProgressivePayload = (payload) => {
        if (
          controller.signal.aborted ||
          state.abort !== controller ||
          !state.enabled ||
          !payload ||
          !Array.isArray(payload.records)
        )
          return;
        state.records = payload.records;
        state.recordById = new Map(
          payload.records.map((record) => [record.id, record]),
        );
        state.lastUpdate = Date.now();
        state.stale = payload.stale === true;
        state.saturated = payload.saturated === true;
        state.failedCategories = Array.isArray(payload.failedCategories)
          ? [...payload.failedCategories]
          : [];
        state.primaryProvider =
          payload.primaryProvider === 'overpass' ? 'overpass' : 'google';
        if (state.selectedId && !state.recordById.has(state.selectedId))
          clearSelection();
        renderRecords();
      };
      const payload = await source.fetchViewport(box, state.params, {
        signal: controller.signal,
        onCategoryProgress: applyProgressivePayload,
      });
      if (
        controller.signal.aborted ||
        state.abort !== controller ||
        !state.enabled
      )
        return;
      state.records = payload.records;
      state.recordById = new Map(
        payload.records.map((record) => [record.id, record]),
      );
      state.lastLoadedKey = requestKey;
      state.lastUpdate = Date.now();
      state.stale = payload.stale === true;
      state.saturated = payload.saturated === true;
      state.failedCategories = Array.isArray(payload.failedCategories)
        ? [...payload.failedCategories]
        : [];
      state.primaryProvider =
        payload.primaryProvider === 'overpass' ? 'overpass' : 'google';
      setStatus(
        statusForSuccessfulSecurityPointsLoad({
          records: state.records,
          stale: state.stale,
          failedCategories: state.failedCategories,
          primaryProvider: state.primaryProvider,
        }),
      );
      if (state.selectedId && !state.recordById.has(state.selectedId))
        clearSelection();
      renderRecords();
    } catch (error) {
      if (
        controller.signal.aborted ||
        state.abort !== controller ||
        !state.enabled ||
        error?.name === 'AbortError'
      )
        return;
      console.warn('[SecurityPoints] viewport load failed', {
        status: 'unavailable',
        message: error?.message || 'Security Points unavailable',
      });
      if (state.records.length > 0) {
        state.lastLoadedKey = requestKey;
        state.lastUpdate = Date.now();
        state.stale = true;
        state.failedCategories = [];
        state.primaryProvider = 'google';
        setStatus(
          statusForFailedSecurityPointsLoad({ hasCachedRecords: true }),
        );
        return;
      }
      setStatus(statusForFailedSecurityPointsLoad(), {
        error: error?.message || 'Security Points unavailable',
      });
    } finally {
      if (state.abort === controller) {
        state.abort = null;
        state.loading = false;
      }
    }
  }

  function installInteraction(viewer) {
    if (state.clickHandler) return;
    state.clickHandler = new Cesium.ScreenSpaceEventHandler(
      viewer.scene.canvas,
    );
    state.clickHandler.setInputAction((click) => {
      if (!isPointerFree() || !state.enabled) return;
      const picked = viewer.scene.pick(click.position);
      const id = typeof picked?.id?.id === 'string' ? picked.id.id : null;
      if (id && state.recordById.has(id)) {
        if (id === state.selectedId) return;
        selectRecord(id);
      } else if (state.selectedId) {
        clearSelection();
        renderRecords();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  const methods = {
    id: LAYER_ID,
    name: 'Security Points',
    icon: '🛡',
    source: 'Google Maps Places (+ optional Overpass fallback)',
    updateInterval: 0,
    statsRefreshInterval: 1000,
    init(viewer) {
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource('security-points');
      viewer.dataSources.add(state.dataSource);
      state.moveEndRemove =
        viewer.camera.moveEnd.addEventListener(scheduleLoad);
      installInteraction(viewer);
      state.dismissListener = () => {
        if (!state.selectedId) return;
        clearSelection();
        renderRecords();
      };
      window.addEventListener(
        'gev:security-point-dismiss',
        state.dismissListener,
      );
    },
    enable() {
      state.enabled = true;
      services.picking.registerPickOwner(LAYER_ID, (id) =>
        state.recordById.has(id),
      );
      state.dataSource.show = true;
    },
    disable() {
      state.enabled = false;
      services.picking.unregisterPickOwner(LAYER_ID);
      clearTimeout(state.timer);
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      if (state.dataSource) state.dataSource.show = false;
      state.lastLoadedKey = '';
      state.failedCategories = [];
      state.primaryProvider = 'google';
      clearRendered();
      clearSelection();
      setStatus('idle');
    },
    update() {
      return loadSecurityPoints();
    },
    destroy(viewer) {
      this.disable();
      state.moveEndRemove?.();
      state.moveEndRemove = null;
      state.clickHandler?.destroy();
      state.clickHandler = null;
      if (state.dismissListener)
        window.removeEventListener(
          'gev:security-point-dismiss',
          state.dismissListener,
        );
      state.dismissListener = null;
      if (state.dataSource && viewer)
        viewer.dataSources.remove(state.dataSource, true);
      state.dataSource = null;
      state.viewer = null;
    },
    setParams(params = {}) {
      const next = { ...state.params };
      let changed = false;
      for (const id of CATEGORY_ORDER) {
        if (!Object.hasOwn(params, id)) continue;
        next[id] = params[id] !== false;
        changed ||= next[id] !== state.params[id];
      }
      if (!changed) return true;
      state.params = next;
      state.lastLoadedKey = '';
      if (state.enabled) scheduleLoad();
      return true;
    },
    getParams() {
      return { ...state.params };
    },
    getRowControls() {
      const counts = categoryCounts(state.records);
      return {
        chips: CATEGORY_ORDER.map((id) => ({
          id,
          label: CATEGORY_CONFIG[id].label.toUpperCase(),
          active: state.params[id] !== false,
          state: state.params[id] !== false ? 'active' : 'idle',
          title: `${state.params[id] !== false ? 'Hide' : 'Show'} ${CATEGORY_CONFIG[id].cardLabel}`,
          params: { [id]: state.params[id] === false },
        })),
        legend: CATEGORY_ORDER.map((id) => ({
          label: CATEGORY_CONFIG[id].label,
          color: CATEGORY_CONFIG[id].color,
          count: counts[id],
        })),
      };
    },
    getStats() {
      const activeCategories = selectedCategoryIds(state.params).length;
      return {
        count: state.records.length,
        countLabel: countLabelForState(state),
        lastUpdate: state.lastUpdate,
        stale: state.stale,
        saturated: state.saturated,
        fallback: state.primaryProvider === 'overpass',
        error: state.error,
        status: state.status,
        loading: state.loading,
        loadingLabel: state.loading
          ? 'loading Security Points'
          : securityPointsStatusMessage({
              status: state.status,
              saturated: state.saturated,
            }) || '',
        statusMessage:
          activeCategories === 0
            ? 'Enable at least one Security Points category'
            : state.status === 'zoom-in'
              ? 'Zoom in to load Security Points'
              : state.error ||
                securityPointsStatusMessage({
                  status: state.status,
                  saturated: state.saturated,
                }),
      };
    },
  };

  return methods;
}

export { createSecurityPointSource } from './source.js';
