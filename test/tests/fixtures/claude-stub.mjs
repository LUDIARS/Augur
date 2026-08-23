let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
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
