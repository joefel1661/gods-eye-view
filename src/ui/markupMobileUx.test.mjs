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
  assert.match(template, /data-markup-tool="route"/);
  assert.match(template, /data-markup-tool="area"/);
  assert.match(template, /data-markup-tool="radius"/);
  assert.match(template, /data-markup-tool="delete"/);
  assert.match(template, /id="markup-manager-sheet"/);
  assert.match(template, /id="markup-metadata-sheet"/);
  assert.match(template, /id="markup-object-sheet"/);
  assert.match(template, /id="markup-object-minimize-btn"/);
  assert.match(template, /id="markup-object-delete-secondary-btn"/);
  assert.match(template, /id="markup-confirm-sheet"/);
  assert.match(template, /data-route-mode="free"/);
  assert.match(template, /data-route-mode="points"/);
});

test('markup object sheet keeps delete secondary and optional fields behind more details', () => {
  assert.match(
    template,
    /id="markup-object-sheet"[\s\S]*?id="markup-object-minimize-btn"[\s\S]*?id="markup-object-delete-secondary-btn"[\s\S]*?id="markup-object-sheet-content"[\s\S]*?id="markup-object-more-fields"[\s\S]*?id="markup-object-custom-wrap"[\s\S]*?id="markup-object-notes"[\s\S]*?class="markup-sheet-footer markup-sheet-footer-sticky"/,
  );
});

test('markup workflows no longer ship native browser prompt, confirm, or alert calls', () => {
  assert.doesNotMatch(markupPanel, /window\.(prompt|confirm|alert)\s*\(/);
});

test('mobile markup sheets and cards stay above the attribution-safe corridor', () => {
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-bottom-sheet \{[\s\S]*?bottom: var\(--mobile-panel-safe-bottom\);[\s\S]*?max-height: var\(--mobile-panel-safe-max-height\);/,
  );
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-context-card \{[\s\S]*?bottom: var\(--mobile-panel-safe-bottom\);/,
  );
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-mobile-overlay \{[\s\S]*?left: 12px;/,
  );
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-mobile-overlay \{[\s\S]*?pointer-events: none;/,
  );
  assert.match(
    mobileCss,
    /#scene-panel\.markup-mobile-mode \.markup-object-sheet \{[\s\S]*?overflow: hidden;/,
  );
});

test('markup styles include active route-mode and mobile card surfaces', () => {
  assert.match(scenesCss, /\.markup-route-mode-btn\.active/);
  assert.match(scenesCss, /\.markup-route-mode-row\[hidden\] \{/);
  assert.match(scenesCss, /\.markup-context-card \{/);
  assert.match(scenesCss, /\.markup-bottom-sheet \{/);
  assert.match(scenesCss, /\.markup-object-sheet-content \{/);
  assert.match(
    scenesCss,
    /\.markup-mobile-overlay,[\s\S]*?\.markup-drawing-status-copy \{[\s\S]*?pointer-events: none;/,
  );
  assert.match(
    scenesCss,
    /\.markup-active-control,[\s\S]*?\.markup-drawing-status-actions \.scene-btn \{[\s\S]*?pointer-events: auto;/,
  );
  assert.match(
    scenesCss,
    /\.markup-object-sheet\.markup-object-sheet-minimized/,
  );
  assert.match(
    scenesCss,
    /\.markup-sheet-footer-sticky \{[\s\S]*?position: sticky;[\s\S]*?bottom: 0;/,
  );
  assert.match(
    scenesCss,
    /\.markup-mobile-overlay\[hidden\],[\s\S]*?\.markup-bottom-sheet\[hidden\],[\s\S]*?\.markup-context-card\[hidden\] \{[\s\S]*?display: none !important;/,
  );
});

test('markup manager actions keep whole labels and reflow into mobile rows', () => {
  assert.match(
    scenesCss,
    /\.markup-row-top \{[\s\S]*?flex-wrap: wrap;/,
  );
  assert.match(
    scenesCss,
    /\.markup-row-title-wrap \{[\s\S]*?flex: 1 1 9rem;/,
  );
  assert.match(
    scenesCss,
    /\.markup-row-actions \{[\s\S]*?flex-wrap: wrap;[\s\S]*?flex: 1 1 16rem;[\s\S]*?margin-left: auto;/,
  );
  assert.match(
    scenesCss,
    /\.markup-row-actions \.scene-btn \{[\s\S]*?display: inline-flex;[\s\S]*?align-items: center;[\s\S]*?justify-content: center;[\s\S]*?min-width: 88px;[\s\S]*?min-height: 42px;[\s\S]*?white-space: nowrap;[\s\S]*?overflow-wrap: normal;[\s\S]*?word-break: normal;/,
  );
  assert.match(
    mobileCss,
    /@media \(max-width: 430px\) \{[\s\S]*?#scene-panel \.markup-manager-row \.markup-row-top \{[\s\S]*?flex-direction: column;[\s\S]*?#scene-panel \.markup-manager-row \.markup-row-actions \{[\s\S]*?display: grid;[\s\S]*?grid-template-columns: repeat\(auto-fit, minmax\(100px, 1fr\)\);[\s\S]*?justify-content: stretch;[\s\S]*?justify-items: stretch;[\s\S]*?align-items: stretch;[\s\S]*?#scene-panel \.markup-manager-row \.markup-row-actions \.scene-btn \{[\s\S]*?width: 100%;[\s\S]*?min-width: 0;/,
  );
});

test('markup source preserves hidden-object rendering gates and mobile return-to-map flow', () => {
  assert.match(markupPanel, /if \(object\.visible === false\) continue;/);
  assert.match(
    markupPanel,
    /let interactionState = 'idle';[\s\S]*?let formMode = null;/,
  );
  assert.match(markupPanel, /let pendingMarkerPosition = null;/);
  assert.match(
    markupPanel,
    /if \(updated\?\.visible === false\) \{\s*viewer\.selectedEntity = null;\s*\} else \{\s*setObjectCard\(markupId, objectId\);/s,
  );
  assert.match(
    markupPanel,
    /if \(found\.markupId !== currentMarkupId\) \{\s*updateStatus\(\s*'Delete mode only removes objects from the active markup\.',\s*\);/s,
  );
  assert.match(
    markupPanel,
    /function currentObjectSheetState\([\s\S]*?function assertObjectSheetState\(/s,
  );
  assert.match(
    markupPanel,
    /console\.assert\(\s*!\(state\.title === 'NEW MARKER' && state\.mode !== 'create'\)/,
  );
  assert.match(
    markupPanel,
    /const state = assertObjectSheetState\(\);[\s\S]*?objectSheetTitle\.textContent =[\s\S]*?objectSubmitBtn\.textContent = state\.primaryAction \|\| 'ADD';[\s\S]*?objectDeleteSecondaryBtn\.hidden = !state\.canDelete;/s,
  );
  assert.doesNotMatch(
    markupPanel,
    /objectSubmitBtn\.textContent =\s*mode === 'edit' \? 'SAVE CHANGES' : config\.submit;/,
  );
  assert.match(
    markupPanel,
    /objectDetailsExpanded =\s*Boolean\(seed\?\.notes\) \|\| objectCategorySelect\.value === 'Other';/,
  );
  assert.match(
    markupPanel,
    /function enterMarkupMode[\s\S]*?setEditingState\(true\);[\s\S]*?returnToMarkupMap\(\);/s,
  );
  assert.match(
    markupPanel,
    /listen\(objectDeleteSecondaryBtn, 'click',[\s\S]*?if \(formMode !== 'edit'\) return;[\s\S]*?preserveSheet: 'object'/s,
  );
  assert.match(
    markupPanel,
    /listen\(objectMinimizeBtn, 'click', \(\) => \{[\s\S]*?formMode !== 'create'[\s\S]*?objectSheetMinimized = !objectSheetMinimized;[\s\S]*?syncObjectSheetPresentation\(\);/s,
  );
  assert.match(
    markupPanel,
    /listen\(objectCategorySelect, 'change', \(\) => \{[\s\S]*?objectDetailsExpanded = true;[\s\S]*?objectMoreFields\.hidden = false;[\s\S]*?objectMoreBtn\.textContent = 'LESS DETAILS';/s,
  );
  assert.match(
    markupPanel,
    /closeSheet\('confirm', \{ restoreConfirmSheet: false \}\);/,
  );
  assert.match(
    markupPanel,
    /function selectTool\(tool\) \{[\s\S]*?activeTool = normalizeToolId\(tool\);[\s\S]*?interactionState = nextDrawingState\(activeTool\);[\s\S]*?formMode = null;[\s\S]*?viewer\.selectedEntity = null;/s,
  );
  assert.match(
    markupPanel,
    /function setMarkerPlacement\(position\) \{[\s\S]*?if \(!isMarkerPlacementActive\(\) \|\| activeSheet === 'object'\) return false;[\s\S]*?pendingMarkerPosition = structuredClone\(coordinate\);[\s\S]*?syncPreviewEntities\(\);[\s\S]*?openObjectSheet\(\{[\s\S]*?geometry: \{ position: structuredClone\(pendingMarkerPosition\) \}/s,
  );
  assert.match(
    markupPanel,
    /function setMarkerPlacement\(position\) \{[\s\S]*?selectedObjectRef = null;[\s\S]*?viewer\.selectedEntity = null;[\s\S]*?syncPreviewEntities\(\);/s,
  );
  assert.match(
    markupPanel,
    /function syncSelectedEntityCard\(\) \{[\s\S]*?if \(!editing \|\| activeTool \|\| formMode === 'create'\) \{[\s\S]*?selectedObjectRef = \{ markupId, objectId \};[\s\S]*?openObjectSheet\(\{[\s\S]*?mode: 'edit'/s,
  );
  assert.match(
    markupPanel,
    /await addObjectToMarkup\([\s\S]*?if \(context\.kind === 'marker' && activeTool === 'marker'\) \{[\s\S]*?pendingMarkerPosition = null;[\s\S]*?interactionState = nextDrawingState\(activeTool\);[\s\S]*?\} else \{[\s\S]*?activeTool = null;[\s\S]*?clearTransientGeometry\(\);[\s\S]*?syncToolButtons\(\);[\s\S]*?bindEditingHandler\(\);[\s\S]*?\}[\s\S]*?returnToMarkupMap\(\);/s,
  );
  assert.match(
    markupPanel,
    /listen\(objectCancelBtn, 'click', \(\) => \{[\s\S]*?if \(formMode === 'create'\) \{[\s\S]*?if \(pendingObjectContext\?\.kind === 'marker' && activeTool === 'marker'\) \{[\s\S]*?pendingMarkerPosition = null;[\s\S]*?syncPreviewEntities\(\);[\s\S]*?\} else \{[\s\S]*?activeTool = null;[\s\S]*?clearTransientGeometry\(\);[\s\S]*?bindEditingHandler\(\);[\s\S]*?\}[\s\S]*?\}[\s\S]*?returnToMarkupMap\(\);/s,
  );
});
