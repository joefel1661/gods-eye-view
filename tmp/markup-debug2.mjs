import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('gev:first-run-mission:v1','1');
  sessionStorage.setItem('gev:first-run-mission-session:v1','1');
});
await page.goto('http://127.0.0.1:4173', {waitUntil:'domcontentloaded'});
await page.waitForFunction(() => Boolean(window.__gevMarkups && document.querySelector('[data-mobile-panel="markup"]')), { timeout: 120000 });
await page.evaluate(async () => {
  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open('gev-markups-v1', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const db = await openDb();
  const markup = {id:'markup-mobile-test',name:'Test',description:'',visible:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),objects:[]};
  await new Promise((resolve, reject) => {
    const tx = db.transaction('markups', 'readwrite');
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.objectStore('markups').put(markup);
  });
});
await page.reload({waitUntil:'domcontentloaded'});
await page.waitForFunction(() => Boolean(window.__gevMarkups && window.__gevMarkups.list().length), { timeout: 120000 });
await page.$eval('[data-mobile-panel="markup"]', (node) => node.click());
await page.$eval('.markup-mobile-tool[data-markup-tool="marker"]', (node) => node.click());
await new Promise(r => setTimeout(r, 1000));
const result = await page.evaluate(() => {
  const viewer = window.__godsEyeView?.viewer;
  const Cesium = window.Cesium;
  if (!viewer || !Cesium) return { ok: false, reason: 'no viewer' };
  viewer.camera.flyHome?.(0);
  const canvas = viewer.scene.canvas;
  const point = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
  const ray = viewer.camera.getPickRay(point);
  const cartesian = ray ? viewer.scene.globe.pick(ray, viewer.scene) : null;
  return {
    ok: Boolean(cartesian),
    canvas: { w: canvas.clientWidth, h: canvas.clientHeight },
    body: document.body.dataset.mobilePanel,
    panel: document.getElementById('scene-panel')?.className,
    overlayHidden: document.getElementById('markup-mobile-overlay')?.hidden,
  };
});
console.log(result);
await browser.close();
