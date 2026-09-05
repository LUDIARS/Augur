// Source-safe TypeScript string literals for values read from manifests.
// JSON supplies the escaping; single quotes preserve the injector's existing
// output for ordinary values and therefore its byte-stable golden fixtures.

export function sourceString(value: string): string {
  const jsonBody = JSON.stringify(value).slice(1, -1);
  return `'${jsonBody.replace(/'/g, "\\'").replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}'`;
}
