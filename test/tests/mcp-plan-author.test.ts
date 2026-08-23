import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createMcpServer } from '../../src/mcp/server.ts';
import { createTestOperations } from '../../src/operations/tests.ts';
import { augurConfig } from './fixtures.ts';
import { analysis, program, repository, stores } from './plan/fixtures.ts';

describe('MCP plan and author parity', () => {
  it('exposes plan, author, and register-from-plan and returns operation-identical JSON', async () => {
    const root = mkdtempSync(join(tmpdir(), 'augur-mcp-plan-'));
    const repo = join(root, 'repo');
    repository(repo);
    const state = stores(root);
    const operations = createTestOperations({
      config: augurConfig(root, repo),
      store: state.runStore,
      planStore: state.planStore,
      planDependencies: { domains: async () => program(), callers: async () => [] },
    });
    const server = createMcpServer(operations);
    const client = new Client({ name: 'test', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'augur_tests_plan', 'augur_tests_author', 'augur_tests_register_from_plan',
      ]));
      const source = { type: 'pr', analysis: analysis() };
      const planCall = await client.callTool({ name: 'augur_tests_plan', arguments: { repoPath: repo, source } });
      const mcpPlan = toolJson(planCall);
      expect(mcpPlan).toEqual(await operations.getPlan((mcpPlan as { planId: string }).planId));
      const planId = (mcpPlan as { planId: string }).planId;
      const authorCall = await client.callTool({
        name: 'augur_tests_author', arguments: { repoPath: repo, planId, author: 'session' },
      });
      expect(toolJson(authorCall)).toEqual(await operations.author({ repoPath: repo, planId, author: 'session' }));
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

function toolJson(result: unknown): unknown {
  const content = (result as { content?: unknown[] }).content;
  const item = content?.[0] as { type?: string; text?: string } | undefined;
  if (item?.type !== 'text' || item.text === undefined) throw new Error('MCP result did not contain text JSON');
  return JSON.parse(item.text) as unknown;
}
