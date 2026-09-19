import { MOBILE_LAYOUT_MEDIA_QUERY } from './layoutBreakpoints.js';

const CARD_ID = 'security-point-card';
let _card = null;
let _selected = null;
let _cleanup = [];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char]);
}

function ensureCard() {
  if (_card) return _card;
  const card = document.createElement('aside');
  card.id = CARD_ID;
  card.hidden = true;
  document.body.appendChild(card);
  _card = card;
  return card;
}

function renderCard(detail) {
  const card = ensureCard();
  if (!detail) {
    card.hidden = true;
    card.innerHTML = '';
    return;
  }
  const distance = Number.isFinite(detail.distanceM)
    ? `<div class="security-point-card-row"><span>Distance</span><strong>${escapeHtml(detail.distanceM >= 1000 ? `${(detail.distanceM / 1000).toFixed(detail.distanceM >= 10000 ? 0 : 1)} km` : `${detail.distanceM} m`)}</strong></div>`
    : '';
  const phoneValue = detail.telHref
    ? `<a class="security-point-card-phone" href="${escapeHtml(detail.telHref)}">${escapeHtml(detail.phone)}</a>`
    : `<strong>${escapeHtml(detail.phoneDisplay || 'Phone not listed')}</strong>`;
  const provider = detail.provider
    ? `<footer class="security-point-card-footer">${detail.providerHref ? `<a href="${escapeHtml(detail.providerHref)}" target="_blank" rel="noopener noreferrer">${escapeHtml(detail.provider)}</a>` : escapeHtml(detail.provider)}</footer>`
    : '';
  card.hidden = false;
  card.innerHTML = `
    <div class="security-point-card-inner" role="group" aria-label="Security Point details">
      <div class="security-point-card-header">
        <div>
          <span class="security-point-card-kicker">SECURITY POINT</span>
          <strong>${escapeHtml(detail.name)}</strong>
        </div>
        <button type="button" class="security-point-card-close" aria-label="Close Security Point details">×</button>
      </div>
      <div class="security-point-card-row"><span>Category</span><strong>${escapeHtml(detail.categoryLabel)}</strong></div>
      <div class="security-point-card-row"><span>Type</span><strong>${escapeHtml(detail.typeLabel || 'Not specified')}</strong></div>
      <div class="security-point-card-row"><span>Address</span><strong>${escapeHtml(detail.address || 'Address not listed')}</strong></div>
      <div class="security-point-card-row"><span>${escapeHtml(detail.phoneLabel)}</span>${phoneValue}</div>
      ${distance}
      ${provider}
    </div>`;
  card.querySelector('.security-point-card-close')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('gev:security-point-dismiss'));
  });
  if (globalThis.matchMedia?.(MOBILE_LAYOUT_MEDIA_QUERY)?.matches) {
    card.setAttribute('data-mobile', 'true');
  } else {
    card.removeAttribute('data-mobile');
  }
}

export function initSecurityPointCard() {
  destroySecurityPointCard();
  ensureCard();
  const onSelected = (event) => {
    _selected = event.detail || null;
    renderCard(_selected);
  };
  const onCleared = () => {
    _selected = null;
    renderCard(null);
  };
  const onResize = () => {
    if (_selected) renderCard(_selected);
  };
  window.addEventListener('gev:security-point-selected', onSelected);
  window.addEventListener('gev:security-point-cleared', onCleared);
  window.addEventListener('resize', onResize);
  _cleanup = [
    () => window.removeEventListener('gev:security-point-selected', onSelected),
    () => window.removeEventListener('gev:security-point-cleared', onCleared),
    () => window.removeEventListener('resize', onResize),
  ];
}

export function destroySecurityPointCard() {
  for (const cleanup of _cleanup) cleanup();
  _cleanup = [];
  _selected = null;
  _card?.remove();
  _card = null;
}
