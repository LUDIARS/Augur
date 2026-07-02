import { buildApp } from './app.ts';

const port = Number(process.env['AUGUR_PORT'] ?? 3000);

const app = buildApp();
app
  .listen({ port, host: '0.0.0.0' })
  .then(() => {
    console.log(`Augur listening on :${port}`);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
