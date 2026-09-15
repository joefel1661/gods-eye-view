import { createServer } from 'vite';

async function start() {
  const server = await createServer({
    server: {
      host: '0.0.0.0',
      port: Number(process.env.PORT) || 4173,
    },
  });

  await server.listen();
  server.printUrls();
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});