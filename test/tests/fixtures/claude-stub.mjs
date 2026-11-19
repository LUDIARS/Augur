let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const expectedModel = process.env.AUGUR_CLAUDE_STUB_EXPECTED_MODEL;
const modelIndex = process.argv.indexOf('--model');
if (expectedModel && (modelIndex < 0 || process.argv[modelIndex + 1] !== expectedModel)) {
  process.stderr.write(`expected --model ${expectedModel}, received ${process.argv[modelIndex + 1]}\n`);
  process.exit(1);
}
const configured = process.env.AUGUR_CLAUDE_STUB_RESPONSE;
if (configured) {
  process.stdout.write(configured);
} else {
  const file = JSON.parse(prompt.match(/Return JSON only: \{"file":("(?:[^"\\]|\\.)*")/)?.[1] ?? '"test/generated.test.ts"');
  process.stdout.write(JSON.stringify({
    file,
    body: 'describe("Assurance: calculate", () => { test("returns the result", () => { expect(2).toBe(2); }); });',
  }));
}
