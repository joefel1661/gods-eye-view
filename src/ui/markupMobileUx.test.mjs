import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);
const template = readFileSync(
  path.join(ROOT, 'src', 'ui', 'templates', 'layer-panels.html'),
  'utf8',
);
const markupPanel = readFileSync(
  path.join(ROOT, 'src', 'ui', 'markupPanel.js'),
  'utf8',
);
const scenesCss = readFileSync(
  path.join(ROOT, 'src', 'ui', 'styles', 'scenes.css'),
  'utf8',
);
const mobileCss = readFileSync(
  path.join(ROOT, 'src', 'ui', 'styles', 'mobile-first.css'),
  'utf8',
);

test('markup template ships the mobile map-first overlay and sheets', () => {
  assert.match(template, /id="markup-mobile-overlay"/);
  assert.match(template, /id="markup-active-control"/);
  assert.match(template, /id="markup-mobile-done-btn"/);
  assert.match(template, /class="markup-mobile-toolbar"/);
  assert.match(template, /data-markup-tool="marker"/);
  assert.match(template, /data-markup-tool="line"/);
  assert.match(template, /data-markup-tool="polygon"/);
  assert.match(template, /data-markup-tool="circle"/);
  assert.match(template, /data-markup-tool="delete"/);
  assert.match(template, /id="markup-manager-sheet"/);
  assert.match(template, /id="markup-metadata-sheet"/);
  assert.match(template, /id="markup-object-sheet"/);
  assert.match(template, /id="markup-confirm-sheet"/);
  assert.match(template, /data-route-mode="free"/);
  assert.match(template, /data-route-mode="points"/);
});

test('markup workflows no longer ship native browser prompt, confirm, or alert calls', () => {
  assert.doesNotMatch(markupPanel, /window\.(prompt|confirm|alert)\s*\(/);
});

test('mobile markup sheets and cards stay above the attribution-safe corridor', () => {
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-bottom-sheet \{[\s\S]*?bottom: calc\(var\(--mobile-attribution-zone-top\) \+ 8px\);/,
  );
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-context-card \{[\s\S]*?bottom: calc\(var\(--mobile-attribution-zone-top\) \+ 8px\);/,
  );
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-mobile-overlay \{[\s\S]*?left: 12px;/,
  );
});

test('markup styles include active route-mode and mobile card surfaces', () => {
  assert.match(scenesCss, /\.markup-route-mode-btn\.active/);
  assert.match(scenesCss, /\.markup-context-card \{/);
  assert.match(scenesCss, /\.markup-bottom-sheet \{/);
});
