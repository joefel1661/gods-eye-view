import { createSecurityPointsLayer } from '../../layers/securityPoints/index.js';
import * as render from '../../renderGovernor.js';
import * as context from '../../data/contextStore.js';
import * as picking from '../../data/pickRegistry.js';

export function createApplicationSecurityPoints({ surface, source }) {
  const { groundFloor: ground } = surface;
  return createSecurityPointsLayer({
    source,
    services: { render, context, picking, ground },
  });
}
