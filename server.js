import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import connect from 'connect';
import serveStatic from 'serve-static';
import { localProviderPlugins } from './server/providers/local.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = connect();

// Reuse GEV's existing provider middleware without starting Vite.
const providerServer = { middlewares: app };

for (const plugin of localProviderPlugins()) {
  if (typeof plugin.configureServer === 'function') {
    plugin.configureServer(providerServer);
  }
}

// Serve the production frontend built by Vite during deployment.
app.use(serveStatic(path.join(__dirname, 'dist')));

// SPA fallback.
app.use((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(
    '<!doctype html><html><body><h1>GEV server is running</h1><p>Frontend build not found.</p></body></html>',
  );
});

const port = Number(process.env.PORT) || 4173;

http.createServer(app).listen(port, '0.0.0.0', () => {
  console.log(`GEV server listening on port ${port}`);
});
