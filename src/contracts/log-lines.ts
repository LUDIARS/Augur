import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const READ_CHUNK_BYTES = 64 * 1024;
export const MAX_LOG_LINE_LENGTH = 8 * 1024 * 1024;

/**
 * Sorted files preserve deterministic input-order ties. Missing logs mean no
 * evidence, but a read failure must reject the report rather than hide evidence.
 * @implements SPEC-CONTRACT-LOG-STREAMING
 */
export async function* readWeaverLogLines(logsDir: string): AsyncGenerator<string> {
  if (!existsSync(logsDir) || !statSync(logsDir).isDirectory()) return;
  const files = readdirSync(logsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => entry.name)
    .sort();
  for (const name of files) yield* readLogFileLines(join(logsDir, name));
}

/** @implements SPEC-CONTRACT-LOG-STREAMING */
async function* readLogFileLines(path: string): AsyncGenerator<string> {
  // The stream decoder retains incomplete UTF-8 characters across byte chunks.
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: READ_CHUNK_BYTES });
  const fragments: string[] = [];
  let length = 0;
  try {
    for await (const chunk of stream) {
      const text = chunk as string;
      let start = 0;
      while (start < text.length) {
        const newline = text.indexOf('\n', start);
        const end = newline === -1 ? text.length : newline;
        length += end - start;
        if (length > MAX_LOG_LINE_LENGTH) {
          throw new Error(`contract log line exceeds ${MAX_LOG_LINE_LENGTH} UTF-16 code units: ${path}`);
        }
        fragments.push(text.slice(start, end));
        if (newline === -1) break;
        const line = fragments.join('');
        fragments.length = 0;
        length = 0;
        if (line.trim() !== '') yield line;
        start = newline + 1;
      }
    }
    const lastLine = fragments.join('');
    if (lastLine.trim() !== '') yield lastLine;
  } finally {
    // Also covers consumer early-return and errors in downstream normalization.
    stream.destroy();
  }
}
