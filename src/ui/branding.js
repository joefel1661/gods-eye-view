export const BRAND_NAME = 'SAUGOPS';
export const BRAND_DESCRIPTOR = 'Operational Intelligence';
export const BRAND_BYLINE = 'Saugment';
export const PRODUCT_DESCRIPTION =
  'SAUGOPS is an operational intelligence platform designed to bring planning, situational awareness, geographic information, and operational resources into a unified environment.';

function createMark(documentRef, className) {
  const mark = documentRef.createElement('span');
  mark.className = className;
  mark.classList.add('brand-logo');
  mark.dataset.logoGaze = '';
  mark.dataset.logoSrc = '/logo.svg';
  mark.setAttribute('aria-hidden', 'true');

  const image = documentRef.createElement('img');
  image.src = '/logo.svg';
  image.alt = '';
  mark.append(image);
  return mark;
}

function createWordmark(documentRef, className) {
  const wordmark = documentRef.createElement('span');
  wordmark.className = className;
  wordmark.classList.add('brand-wordmark');

  const saug = documentRef.createElement('span');
  saug.className = 'brand-wordmark-saug';
  saug.textContent = 'SAUG';

  const ops = documentRef.createElement('span');
  ops.className = 'brand-wordmark-ops';
  ops.textContent = 'OPS';

  wordmark.append(saug, ops);
  return wordmark;
}

export function createCompactBrandLockup(documentRef = document) {
  const lockup = documentRef.createElement('div');
  lockup.className = 'brand-lockup brand-lockup-compact';

  const mark = createMark(documentRef, 'brand-mark title-logo');
  const copy = documentRef.createElement('div');
  copy.className = 'brand-copy';

  const heading = documentRef.createElement('div');
  heading.className = 'brand-heading';
  heading.append(createWordmark(documentRef, 'brand-wordmark-compact'));

  const subhead = documentRef.createElement('p');
  subhead.className = 'brand-subhead brand-subhead-compact';
  subhead.textContent = BRAND_DESCRIPTOR;

  const byline = documentRef.createElement('p');
  byline.className = 'brand-byline brand-byline-compact';
  byline.append('by ');
  const brandName = documentRef.createElement('strong');
  brandName.textContent = BRAND_BYLINE;
  byline.append(brandName);

  copy.append(heading, subhead, byline);
  lockup.append(mark, copy);
  return lockup;
}

export function createStackedBrandLockup(documentRef = document) {
  const lockup = documentRef.createElement('div');
  lockup.className = 'brand-lockup brand-lockup-stacked';

  const mark = createMark(documentRef, 'brand-mark loader-logo');
  const heading = documentRef.createElement('h2');
  heading.className = 'brand-heading';
  heading.append(createWordmark(documentRef, 'brand-wordmark-stacked'));

  const subhead = documentRef.createElement('p');
  subhead.className = 'brand-subhead';
  subhead.textContent = BRAND_DESCRIPTOR;

  const byline = documentRef.createElement('p');
  byline.className = 'brand-byline';
  byline.append('by ');
  const brandName = documentRef.createElement('strong');
  brandName.textContent = BRAND_BYLINE;
  byline.append(brandName);

  lockup.append(mark, heading, subhead, byline);
  return lockup;
}

export function mountBranding(root = document) {
  if (!root?.querySelectorAll) return;
  for (const slot of root.querySelectorAll('[data-brand-surface]')) {
    const surface = slot.dataset.brandSurface;
    if (surface === 'compact') {
      slot.replaceChildren(createCompactBrandLockup(slot.ownerDocument));
    } else if (surface === 'stacked') {
      slot.replaceChildren(createStackedBrandLockup(slot.ownerDocument));
    }
  }
}
