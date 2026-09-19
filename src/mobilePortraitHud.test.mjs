import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(
  new URL('./ui/styles/mobile-first.css', import.meta.url),
  'utf8',
);
const PORTRAIT_430_QUERY = '@media (max-width: 430px) and (orientation: portrait)';
const PORTRAIT_390_QUERY = '@media (max-width: 390px) and (orientation: portrait)';

function mediaBlock(query, nextQuery) {
  const start = css.indexOf(query);
  assert.notEqual(start, -1, `missing media query: ${query}`);
  const end = nextQuery ? css.indexOf(nextQuery, start + query.length) : css.length;
  return css.slice(start, end === -1 ? css.length : end);
}

test('narrow portrait phones simplify and reflow the fixed HUD readouts', () => {
  const portrait430 = mediaBlock(PORTRAIT_430_QUERY, PORTRAIT_390_QUERY);

  assert.match(
    portrait430,
    /#intel-hud\.active \.hud-top-bar,[\s\S]*?#intel-hud \.hud-bottom-right,[\s\S]*?#intel-hud \.hud-ais-vessel \{\s*display: none;/,
  );
  assert.match(
    portrait430,
    /#intel-hud \.hud-top-left \{[\s\S]*?top: calc\(var\(--mobile-safe-top\) \+ 46px\);[\s\S]*?right: 12px;[\s\S]*?left: 12px;/,
  );
  assert.match(
    portrait430,
    /#intel-hud \.hud-bottom-left \{[\s\S]*?bottom: calc\(var\(--mobile-panel-bottom\) \+ 84px\);/,
  );
  assert.match(
    portrait430,
    /#intel-hud \.hud-summary \{[\s\S]*?white-space: normal;[\s\S]*?-webkit-line-clamp: 3;/,
  );
  assert.match(
    portrait430,
    /#hud-mgrs,[\s\S]*?#hud-alt \{[\s\S]*?overflow-wrap: anywhere;/,
  );
});

test('narrow portrait phones keep the floating mic and first-run launcher out of the bottom-nav lane', () => {
  const portrait430 = mediaBlock(PORTRAIT_430_QUERY, PORTRAIT_390_QUERY);
  const portrait390 = mediaBlock(PORTRAIT_390_QUERY);

  assert.match(
    portrait430,
    /#command-dock > #gev-voice-control:not\(\[data-status='idle'\]\) \{[\s\S]*?left: auto;[\s\S]*?width: min\(15rem, calc\(100vw - 24px\)\);/,
  );
  assert.match(
    portrait430,
    /#first-run-launcher \{[\s\S]*?bottom: calc\(var\(--mobile-panel-bottom\) \+ 12px\);[\s\S]*?max-height: calc\(/,
  );
  assert.match(
    portrait390,
    /#hud-gsd \{\s*display: none;/,
  );
  assert.match(
    portrait390,
    /#command-dock > #gev-voice-control:not\(\[data-status='idle'\]\) \{[\s\S]*?width: min\(13\.5rem, calc\(100vw - 24px\)\);/,
  );
});
