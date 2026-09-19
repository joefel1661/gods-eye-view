import { defaultSurface } from './surfaceServices.js';
import { createApplicationSecurityPoints } from '../app/layers/securityPoints.js';
import { createSourceSlot } from '../sources/sourceSlot.js';
import { createSecurityPointSource } from '../layers/securityPoints/index.js';

const sourceSlot = createSourceSlot(
  createSecurityPointSource(),
  ['fetchViewport', 'enrichRecord'],
  'Security Points source',
);

export const configureSecurityPointSource = sourceSlot.configure;

export default createApplicationSecurityPoints({
  surface: defaultSurface,
  source: sourceSlot.source,
});
