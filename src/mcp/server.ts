import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createTestOperations, type DefaultTestOperations, type TestOperations } from '../operations/tests.ts';
import { formatReportMarkdown } from '../tests/report.ts';
import { bundleKindSchema } from '../tests/types.ts';

const repositoryShape = {
  repository: z.string().optional(),
  repoPath: z.string().optional(),
};

export function createMcpServer(
  operations: TestOperations & Partial<Pick<DefaultTestOperations, 'resolveRepo'>> = createTestOperations(),
): McpServer {
  const server = new McpServer({ name: 'augur', version: '0.1.0' });

  server.registerTool('augur_tests_catalog', {
    description: 'List business-domain features and their registered tests.',
    inputSchema: repositoryShape,
  }, tool(async (input) => await operations.catalog({ repoPath: resolveRepo(input, operations) })));

  server.registerTool('augur_tests_list', {
    description: 'List registered tests.',
    inputSchema: { ...repositoryShape, domain: z.string().optional(), kind: z.string().optional(), status: z.string().optional() },
  }, tool(async (input) => await operations.listTests({
    repoPath: resolveRepo(input, operations),
    ...(input.domain === undefined ? {} : { domain: input.domain }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.status === undefined ? {} : { status: input.status }),
  })));

  server.registerTool('augur_tests_plan', {
    description: 'Create a deterministic test plan (Phase T2).',
    inputSchema: { ...repositoryShape, source: z.unknown() },
  }, tool(async (input) => await operations.plan(input)));

  server.registerTool('augur_tests_register_from_plan', {
    description: 'Register session-authored tests from a stored plan.',
    inputSchema: { repoPath: z.string(), planId: z.string() },
  }, tool(async (input) => await operations.registerFromPlan(input)));

  server.registerTool('augur_tests_author', {
    description: 'Author tests from a stored plan (Phase T2).',
    inputSchema: {
      repoPath: z.string(),
      planId: z.string(),
      author: z.enum(['session', 'claude-cli']),
      bus: z.string().optional(),
      before: z.string().optional(),
    },
  }, tool(async (input) => await operations.author(input)));

  server.registerTool('augur_tests_run', {
    description: 'Run a registered test bundle.',
    inputSchema: {
      ...repositoryShape,
      bundle: z.union([z.string(), z.object({ kind: bundleKindSchema, selector: z.string().nullable().optional() })]),
      head: z.string().optional(),
      bus: z.string().optional(),
      cached: z.boolean().optional(),
    },
  }, tool(async (input) => await operations.run(input)));

  server.registerTool('augur_tests_report', {
    description: 'Render a run report; markdown is the default for agent readers.',
    inputSchema: { runId: z.string(), format: z.enum(['json', 'markdown']).optional() },
  }, tool(async (input) => {
    const report = await operations.report(input.runId);
    return input.format === 'json' ? report : formatReportMarkdown(report);
  }));

  server.registerTool('augur_tests_verdict', {
    description: 'Attach a human or session verdict to a run.',
    inputSchema: {
      runId: z.string(),
      decision: z.enum(['accept', 'reject']),
      by: z.string(),
      note: z.string().optional(),
    },
  }, tool(async (input) => await operations.verdict(input.runId, {
    decision: input.decision,
    by: input.by,
    at: new Date().toISOString(),
    ...(input.note === undefined ? {} : { note: input.note }),
  })));

  server.registerTool('augur_tests_flag', {
    description: 'Push an accepted passing run to Revisor as external verification.',
    inputSchema: { runId: z.string(), pullRequestId: z.string() },
  }, tool(async (input) => await operations.flag(input.runId, { pullRequestId: input.pullRequestId })));

  server.registerTool('augur_tests_runs', {
    description: 'List cached test runs.',
    inputSchema: {
      repository: z.string().optional(),
      headSha: z.string().optional(),
      since: z.string().optional(),
      status: z.enum(['passed', 'failed', 'error']).optional(),
      bundleKind: bundleKindSchema.optional(),
    },
  }, tool(async (input) => await operations.listRuns(input)));

  server.registerResource(
    'augur-tests-catalog',
    new ResourceTemplate('augur://tests/{repository}/catalog', { list: undefined }),
    { mimeType: 'application/json', description: 'Augur service feature and test catalog.' },
    async (uri, variables) => {
      const repository = decodeURIComponent(String(variables.repository));
      const catalog = await operations.catalog({ repoPath: resolveRepo({ repository }, operations) });
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(catalog, null, 2) }] };
    },
  );

  return server;
}

export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  await server.connect(new StdioServerTransport());
}

function tool<T extends Record<string, unknown>>(
  operation: (input: T) => Promise<unknown>,
): (input: T) => Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  return async (input) => {
    try {
      const result = await operation(input);
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: messageOf(error) }], isError: true };
    }
  };
}

function resolveRepo(
  input: { repository?: string | undefined; repoPath?: string | undefined },
  operations: TestOperations & Partial<Pick<DefaultTestOperations, 'resolveRepo'>>,
): string {
  if (operations.resolveRepo !== undefined) return operations.resolveRepo(input);
  if (input.repoPath !== undefined) return input.repoPath;
  throw new Error('repository or repoPath is required');
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
