import { LayerPanel } from '../ui/layers.js';
import { governorRequestRender } from '../renderGovernor.js';
import { markDetectionSourcesChanged } from '../data/detection.js';

/** Own the layer panel and application reactions to lifecycle activity. */
export class LayerPresentation {
  constructor(
    manager,
    {
      requestRender = governorRequestRender,
      invalidateDetection = markDetectionSourcesChanged,
    } = {},
  ) {
    this.manager = manager;
    this._panel = null;
    this.pendingVisible = false;
    this._unsubscribe = manager.subscribeActivity((change) => {
      if (change.type === 'status') this.refresh();
      else if (change.type === 'destroy-all') this.destroy();
      else {
        const reason =
          change.type === 'data-updated'
            ? `layer-tick:${change.layerId}`
            : change.type === 'visibility-settled'
              ? 'layer-visibility'
              : change.type === 'params-settled'
                ? `layer-params:${change.layerId}`
                : null;
        if (!reason) return;
        requestRender(reason);
        if (change.type !== 'params-settled') invalidateDetection(reason);
      }
    });
  }
  get panel() {
    if (!this._panel)
      this._panel = new LayerPanel({
        getLayers: () => this._panelRows(),
        isEnabled: (id) => this.manager.isEnabled(id),
        setEnabled: (id, enabled, options) =>
          this.manager.setEnabled(id, enabled, options),
        setLayerParams: (id, params, options) =>
          this.manager.setLayerParams(id, params, options),
        getRowControls: (id) => {
          const module = this.manager.layers.get(id)?.module;
          try {
            return module?.getRowControls?.() || null;
          } catch (error) {
            console.warn(`[Data] ${id} getRowControls error:`, error);
            return null;
          }
        },
        hasRowControls: (id) =>
          typeof this.manager.layers.get(id)?.module?.getRowControls ===
          'function',
        subscribeRowControls: (id, listener) => {
          const module = this.manager.layers.get(id)?.module;
          module?.setRowControlsListener?.(listener);
          return () => module?.setRowControlsListener?.(null);
        },
        onHiddenRefresh: () => {
          this.pendingVisible = true;
        },
      });
    return this._panel;
  }
  mount(container) {
    this.panel.mount(container);
  }
  refresh() {
    this._panel?._refreshTogglePanel();
  }
  flushVisible() {
    if (!this.pendingVisible) return;
    this.pendingVisible = false;
    this.refresh();
  }
  destroy() {
    this._panel?.destroy();
    this._panel = null;
    this.pendingVisible = false;
    this._unsubscribe?.();
    this._unsubscribe = null;
  }
  _panelRows() {
    return this.manager.getAll().flatMap((layer) => {
      const module = this.manager.layers.get(layer.id)?.module;
      const rows = module?.getPanelRows?.(layer);
      if (!Array.isArray(rows) || rows.length === 0) return [layer];
      return rows.map((row) => ({
        ...row,
        panelToggle:
          typeof row.panelToggle === 'function'
            ? row.panelToggle
            : (enabled, options) =>
                this._togglePanelCategory(layer.id, row.panelCategoryId, enabled, options),
      }));
    });
  }
  async _togglePanelCategory(layerId, categoryId, enabled, options) {
    const module = this.manager.layers.get(layerId)?.module;
    const categories = Array.isArray(module?.categoryOrder)
      ? module.categoryOrder
      : [];
    if (!categories.includes(categoryId)) {
      return this.manager.setEnabled(layerId, enabled, options);
    }
    const currentParams =
      typeof module?.getParams === 'function' ? module.getParams() : {};
    const nextParams = Object.fromEntries(
      categories.map((id) => [id, currentParams[id] !== false]),
    );
    if (enabled) {
      if (!this.manager.isEnabled(layerId)) {
        for (const id of categories) nextParams[id] = false;
      }
      nextParams[categoryId] = true;
      await this.manager.setLayerParams(layerId, nextParams, options);
      return this.manager.setEnabled(layerId, true, options);
    }
    nextParams[categoryId] = false;
    const anyEnabled = Object.values(nextParams).some(Boolean);
    await this.manager.setLayerParams(layerId, nextParams, options);
    if (!anyEnabled) return this.manager.setEnabled(layerId, false, options);
    return true;
  }
}
