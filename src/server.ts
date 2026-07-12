import { serve } from "@hono/node-server";
import { pino } from "pino";
import { createApp } from "./app.ts";
import { loadConfig } from "./config/config.ts";

const config = loadConfig();
const logger = pino({ level: config.logLevel });

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "[fatal] uncaught exception");
  process.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.fatal({ reason }, "[fatal] unhandled rejection");
  process.exit(1);
});

const app = createApp(logger);

// tier: personal のため loopback bind (spec/design.md I-3 認証境界)
serve({ fetch: app.fetch, port: config.port, hostname: "127.0.0.1" }, (info) => {
  logger.info({ port: info.port }, "Augur listening");
});
