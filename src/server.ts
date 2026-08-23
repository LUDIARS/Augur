import { serve, type ServerType } from '@hono/node-server';
import { pino } from 'pino';
import { createApp } from './app.ts';
import { loadConfig } from './config/config.ts';
import type { TestOperations } from './operations/tests.ts';

export interface StartServerOptions {
  operations?: TestOperations;
  installProcessHandlers?: boolean;
}

export function startServer(options: StartServerOptions = {}): ServerType {
  const config = loadConfig();
  const logger = pino({ level: config.logLevel });
  if (options.installProcessHandlers !== false) installProcessHandlers(logger);
  const app = createApp(logger, options.operations);
  return serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
    logger.info({ port: info.port }, 'Augur listening');
  });
}

function installProcessHandlers(logger: { fatal: (object: unknown, message?: string) => void }): void {
  process.once('uncaughtException', (error) => {
    logger.fatal({ err: error }, '[fatal] uncaught exception');
    process.exit(1);
  });
  process.once('unhandledRejection', (reason) => {
    logger.fatal({ reason }, '[fatal] unhandled rejection');
    process.exit(1);
  });
}
