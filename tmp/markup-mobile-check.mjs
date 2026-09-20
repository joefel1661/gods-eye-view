import puppeteer from 'puppeteer';

const APP_URL = 'http://127.0.0.1:4173';
const FIRST_RUN_STORAGE_KEY = 'gev:first-run-mission:v1';
const FIRST_RUN_SESSION_KEY = 'gev:first-run-mission-session:v1';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader'],
});

const page = await browser.newPage();
page.on('console', (message) => {
  const text = message.text();
  if (text) console.log('[console]', text);
});
page.on('pageerror', (error) => {
  console.error('[pageerror]', error);
});
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((storageKey, sessionKey) => {
  localStorage.setItem(storageKey, '1');
  sessionStorage.setItem(sessionKey, '1');
}, FIRST_RUN_STORAGE_KEY, FIRST_RUN_SESSION_KEY);

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__gevMarkups && document.querySelector('[data-mobile-panel="markup"]')), { timeout: 120000 });

const markupSeed = {
  id: 'markup-mobile-test',
  name: 'Test',
  description: '',
  visible: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  objects: [],
};

await page.evaluate(async (markup) => {
  const openDb = () =>
    new Promise((resolve, reject) => {
      const request = indexedDB.open('gev-markups-v1', 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('markups')) {
          db.createObjectStore('markups', { keyPath: 'id' });
        }
      };
      request.onerror = () => reject(request.error || new Error('open failed'));
      request.onsuccess = () => resolve(request.result);
    });
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction('markups', 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('put failed'));
    tx.objectStore('markups').put(markup);
  });
  db.close();
}, markupSeed);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__gevMarkups && window.__gevMarkups.list().some((markup) => markup.id === 'markup-mobile-test')), { timeout: 120000 });

async function click(selector) {
  await page.waitForSelector(selector, { visible: true, timeout: 120000 });
  await page.$eval(selector, (node) => node.click());
}

async function waitForHidden(selector) {
  await page.waitForFunction((target) => {
    const node = document.querySelector(target);
    return !node || node.hidden || node.getAttribute('hidden') !== null;
  }, { timeout: 120000 }, selector);
}

async function objectSheetState() {
  return page.evaluate(() => {
    const sheet = document.getElementById('markup-object-sheet');
    const title = document.getElementById('markup-object-sheet-title');
    const submit = document.getElementById('markup-object-submit-btn');
    const cancel = document.getElementById('markup-object-cancel-btn');
    return {
      hidden: !sheet || sheet.hidden,
      title: title?.textContent?.trim() || '',
      submit: submit?.textContent?.trim() || '',
      cancel: cancel?.textContent?.trim() || '',
    };
  });
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

await click('[data-mobile-panel="markup"]');
await page.waitForFunction(() => document.body.dataset.mobilePanel === 'markup', { timeout: 120000 });
let sheet = await objectSheetState();
expect(sheet.hidden, 'Markup entry opened object details unexpectedly');
expect(await page.$('#markup-metadata-sheet:not([hidden])') === null, 'Markup entry opened metadata unexpectedly');

await click('.markup-mobile-tool[data-markup-tool="marker"]');
sheet = await objectSheetState();
expect(sheet.hidden, 'Selecting marker opened details before placement');
const markerActive = await page.$eval('.markup-mobile-tool[data-markup-tool="marker"]', (button) => button.classList.contains('active'));
expect(markerActive, 'Marker tool did not become active');

await page.waitForSelector('canvas', { visible: true, timeout: 120000 });
const canvasBox = await page.$eval('canvas', (canvas) => {
  const rect = canvas.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.mouse.click(canvasBox.x, canvasBox.y);
await page.waitForFunction(() => {
  const sheet = document.getElementById('markup-object-sheet');
  return sheet && !sheet.hidden;
}, { timeout: 120000 });

sheet = await objectSheetState();
expect(sheet.title === 'NEW MARKER', `Expected NEW MARKER sheet, got ${sheet.title}`);
expect(sheet.cancel === 'CANCEL', 'New marker sheet is missing CANCEL');
expect(sheet.submit === 'ADD MARKER', `Expected ADD MARKER action, got ${sheet.submit}`);

const previewCount = await page.evaluate(() => {
  const viewer = window.__godsEyeView?.viewer;
  const source = viewer?.dataSources?.getByName?.('gev-markups')?.[0];
  return source?.entities?.values?.filter((entity) => !entity.properties?.gevMarkupId && entity.point).length || 0;
});
expect(previewCount > 0, 'Marker preview was not rendered after map tap');

await page.type('#markup-object-name', 'Test Marker');
await click('#markup-object-submit-btn');
await waitForHidden('#markup-object-sheet');

let saved = await page.evaluate(() => {
  const markup = window.__gevMarkups.list().find((entry) => entry.id === 'markup-mobile-test');
  return markup?.objects?.map((object) => ({ title: object.title, type: object.type })) || [];
});
expect(saved.some((object) => object.title === 'Test Marker' && object.type === 'marker'), 'Saved marker missing after submit');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__gevMarkups), { timeout: 120000 });
saved = await page.evaluate(() => {
  const markup = window.__gevMarkups.list().find((entry) => entry.id === 'markup-mobile-test');
  return markup?.objects?.map((object) => ({ id: object.id, title: object.title, type: object.type, position: object.geometry?.position })) || [];
});
const savedMarker = saved.find((object) => object.title === 'Test Marker' && object.type === 'marker');
expect(Boolean(savedMarker), 'Saved marker did not persist after reload');

await click('[data-mobile-panel="markup"]');
await page.waitForFunction(() => document.body.dataset.mobilePanel === 'markup', { timeout: 120000 });
const markerScreen = await page.evaluate((markerId) => {
  const viewer = window.__godsEyeView?.viewer;
  const Cesium = window.Cesium;
  const markup = window.__gevMarkups.list().find((entry) => entry.id === 'markup-mobile-test');
  const marker = markup?.objects?.find((object) => object.id === markerId);
  const position = marker?.geometry?.position;
  if (!viewer || !Cesium || !position) return null;
  const cartesian = Cesium.Cartesian3.fromDegrees(
    position.lon,
    position.lat,
    position.height || 0,
  );
  const screen = Cesium.SceneTransforms.wgs84ToWindowCoordinates(viewer.scene, cartesian);
  return screen ? { x: screen.x, y: screen.y } : null;
}, savedMarker.id);
expect(markerScreen && Number.isFinite(markerScreen.x) && Number.isFinite(markerScreen.y), 'Could not resolve saved marker screen position');
await page.mouse.click(markerScreen.x, markerScreen.y);
await page.waitForFunction(() => {
  const title = document.getElementById('markup-object-sheet-title');
  return title && title.textContent.trim() === 'EDIT MARKER';
}, { timeout: 120000 });

sheet = await objectSheetState();
expect(sheet.cancel === 'CANCEL', 'Edit marker sheet is missing CANCEL');
expect(sheet.submit === 'SAVE CHANGES', `Expected SAVE CHANGES action, got ${sheet.submit}`);
await page.click('#markup-object-name', { clickCount: 3 });
await page.type('#markup-object-name', 'Updated Marker');
await click('#markup-object-submit-btn');
await waitForHidden('#markup-object-sheet');

const updatedMarker = await page.evaluate((markerId) => {
  const markup = window.__gevMarkups.list().find((entry) => entry.id === 'markup-mobile-test');
  return markup?.objects?.find((object) => object.id === markerId)?.title || null;
}, savedMarker.id);
expect(updatedMarker === 'Updated Marker', 'Marker edit did not persist');

await click('.markup-mobile-tool[data-markup-tool="polygon"]');
sheet = await objectSheetState();
expect(sheet.hidden, 'Selecting area opened details before finishing geometry');

const offsets = [
  { x: canvasBox.x - 24, y: canvasBox.y - 24 },
  { x: canvasBox.x + 24, y: canvasBox.y - 12 },
  { x: canvasBox.x + 8, y: canvasBox.y + 28 },
];
for (const point of offsets) {
  await page.mouse.click(point.x, point.y);
  await sleep(100);
}

sheet = await objectSheetState();
expect(sheet.hidden, 'Area form opened before Finish');
const polygonPreview = await page.evaluate(() => {
  const viewer = window.__godsEyeView?.viewer;
  const source = viewer?.dataSources?.getByName?.('gev-markups')?.[0];
  return source?.entities?.values?.some((entity) => !entity.properties?.gevMarkupId && entity.polygon) || false;
});
expect(polygonPreview, 'Polygon preview did not appear after three points');
await click('#markup-status-finish-btn');
await page.waitForFunction(() => {
  const title = document.getElementById('markup-object-sheet-title');
  return title && title.textContent.trim() === 'NEW AREA';
}, { timeout: 120000 });

console.log('Manual mobile markup verification passed.');
await browser.close();
