export interface VitestReport { testResults?: unknown }

/**
 * Tests share the runner's stdout, so a `console.log` (or a library banner) can
 * land before or after the JSON reporter's document — including text with its
 * own braces. Taking "first `{` to last `}`" then spans the noise and fails to
 * parse, which turned a whole bundle into "invalid vitest JSON reporter output"
 * although every test ran. Instead, each balanced top-level object is tried and
 * the one that carries `testResults` is the report.
 */
export function parseJsonReport(stdout: string): VitestReport {
  try {
    const whole = JSON.parse(stdout) as unknown;
    if (isReport(whole)) return whole;
  } catch {
    // fall through to the scan below
  }
  let sawObject = false;
  for (let start = stdout.indexOf('{'); start >= 0; start = stdout.indexOf('{', start + 1)) {
    const end = matchingBrace(stdout, start);
    if (end < 0) continue;
    sawObject = true;
    try {
      const value = JSON.parse(stdout.slice(start, end + 1)) as unknown;
      if (isReport(value)) return value;
    } catch {
      // not JSON (e.g. a logged JS object); keep scanning
    }
  }
  throw new Error(sawObject ? 'no JSON document with testResults found' : 'JSON document not found');
}

function isReport(value: unknown): value is VitestReport {
  return typeof value === 'object' && value !== null && Array.isArray((value as VitestReport).testResults);
}

/** Index of the `}` closing the object opened at `start`, honouring JSON strings; -1 if unbalanced. */
function matchingBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}
