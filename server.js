import { createServer } from 'vite';

const server = await createServer({
  server: {
    host: '0.0.0.0',
    port: Number(process.env.PORT) || 4173,
  },
});

await server.listen();

server.printUrls();