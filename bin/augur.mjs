#!/usr/bin/env node
// The entry point other tools invoke as `node <augurFolder>/bin/augur.mjs <cmd>`
// — no shell, no PATH assumption (spec/interface/cli.md, "Entry point").
//
// A built `dist/` is used when present. Otherwise the TypeScript source is run
// directly, which needs type stripping: Node enables it by default from 22.18,
// and before that it requires --experimental-strip-types. Rather than detect the
// version, the shim tries the import and re-executes itself with the flag only if
// Node rejects the syntax — the check is then about what this Node actually does,
// not about what its version number implies.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const self = fileURLToPath(import.meta.url);
const root = resolve(dirname(self), "..");
const built = join(root, "dist", "cli", "main.js");
const source = join(root, "src", "cli", "main.ts");
const RETRY_ENV = "AUGUR_CLI_STRIPPED";

function isTypeStrippingFailure(error) {
  const message = String(error?.message ?? "");
  return (
    error?.code === "ERR_UNKNOWN_FILE_EXTENSION"
    || error?.code === "ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING"
    || /experimental-strip-types|Unknown file extension "\.ts"/.test(message)
  );
}

// This shim is re-executed, not `source`: `src/cli/main.ts` only exports `main`,
// so running it as the entry point would import the module, invoke nothing and
// exit 0 — a silent no-op instead of a plan. The flag applies to the whole
// process, so the child's dynamic import of the same `.ts` succeeds.
function reexecuteWithStripTypes() {
  const result = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", self, ...process.argv.slice(2)],
    { stdio: "inherit", env: { ...process.env, [RETRY_ENV]: "1" } },
  );
  // A signal leaves status null; 2 is this CLI's "unexpected internal error".
  process.exit(result.status === null ? 2 : result.status);
}

async function load() {
  if (existsSync(built)) return import(pathToFileURL(built).href);
  try {
    return await import(pathToFileURL(source).href);
  } catch (error) {
    if (process.env[RETRY_ENV] === "1" || !isTypeStrippingFailure(error)) throw error;
    reexecuteWithStripTypes();
    return null;
  }
}

// A failure to even load the implementation is an internal error, not a usage
// error: letting the rejection escape would exit 1 and tell the caller it asked
// wrong (spec/interface/cli.md, "Exit Codes").
const loaded = await load().catch((error) => {
  process.stderr.write(`error: ${error?.stack ?? error}\n`);
  process.exitCode = 2;
  return null;
});
if (loaded !== null) {
  const io = {
    cwd: process.cwd(),
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    readStdin: loaded.readStdinSync,
  };
  try {
    process.exitCode = await loaded.main(process.argv.slice(2), io);
  } catch (error) {
    // An escaped failure is an internal error, not a usage error: an unhandled
    // rejection would exit 1 and tell the caller it asked wrong.
    process.stderr.write(`error: ${error?.stack ?? error}\n`);
    process.exitCode = 2;
  }
}
