import puppeteer from 'puppeteer';
const browser = await puppeteer.launch({headless:'new', args:['--no-sandbox','--disable-setuid-sandbox','--use-angle=swiftshader']});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('gev:first-run-mission:v1','1');
  sessionStorage.setItem('gev:first-run-mission-session:v1','1');
});
await page.goto('http://127.0.0.1:4173', {waitUntil:'domcontentloaded'});
await page.waitForFunction(() => Boolean(window.__gevMarkups && document.querySelector('[data-mobile-panel="markup"]')), { timeout: 120000 });
const before = await page.evaluate(() => ({ body: document.body.dataset.mobilePanel || null, pressed: document.querySelector('[data-mobile-panel="markup"]')?.getAttribute('aria-pressed'), display: getComputedStyle(document.querySelector('[data-mobile-panel="markup"]')).display }));
console.log('before', before);
await page.$eval('[data-mobile-panel="markup"]', (btn) => btn.click());
await new Promise(r => setTimeout(r, 1000));
const after = await page.evaluate(() => ({ body: document.body.dataset.mobilePanel || null, pressed: document.querySelector('[data-mobile-panel="markup"]')?.getAttribute('aria-pressed'), panelHidden: document.getElementById('scene-panel')?.className, overlayHidden: document.getElementById('markup-mobile-overlay')?.hidden }));
console.log('after', after);
await browser.close();
