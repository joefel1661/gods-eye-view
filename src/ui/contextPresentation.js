export function _syncContextModeButtons() {
  if (this.destroyed) return;
  const flightsActive = this._contextMode === 'flights';
  const camerasActive = this._contextSection === 'cameras';
  const contactsActive = !camerasActive;
  const panel = this._globalContextPanel;
  panel?.classList.toggle('context-enabled', flightsActive);
  panel?.setAttribute('data-context-mode', this._contextMode || 'none');
  panel?.setAttribute(
    'data-context-section',
    camerasActive ? 'cameras' : 'contacts',
  );
  this._globalContextFlightsBtn?.classList.toggle('active', contactsActive);
  this._globalContextFlightsBtn?.setAttribute(
    'aria-selected',
    String(contactsActive),
  );
  this._globalContextCamerasBtn?.classList.toggle('active', camerasActive);
  this._globalContextCamerasBtn?.setAttribute(
    'aria-selected',
    String(camerasActive),
  );
  const transitionBusy = Boolean(this._contextModeChanging);
  // Both Context choices stay in the ordinary Tab sequence. Arrow keys still
  // provide tablist navigation, but must not be the only way to reach Space
  // Missions from the keyboard. Semantic busy state keeps them perceivable
  // while synchronous click guards prevent a second transition.
  for (const button of [
    this._globalContextFlightsBtn,
    this._globalContextCamerasBtn,
  ]) {
    if (!button) continue;
    button.disabled = false;
    button.tabIndex = 0;
    button.setAttribute('aria-disabled', String(transitionBusy));
    button.setAttribute('aria-busy', String(transitionBusy));
  }
  if (this._contextModeStandby)
    this._contextModeStandby.hidden = !contactsActive || flightsActive;
  if (this._contextFlightsView) {
    this._contextFlightsView.hidden = !contactsActive || !flightsActive;
    this._contextFlightsView.setAttribute(
      'aria-hidden',
      String(!contactsActive || !flightsActive),
    );
  }
  if (this._contextCamerasView) {
    this._contextCamerasView.hidden = !camerasActive;
    this._contextCamerasView.setAttribute(
      'aria-hidden',
      String(!camerasActive),
    );
  }
  this.cockpitView?.syncEntry();
  // Every _contextMode mutation funnels through here; the sync no-ops until
  // the transaction settles, so this is the activation/deactivation edge.
  this.actions.syncDetection();
  this.actions.scheduleLayout();
}
