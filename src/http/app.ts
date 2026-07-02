import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { createPlan } from '../engine/createPlan.ts';
import type { CreatePlanRequest } from '../schema/index.ts';

// One route per endpoint in spec/interface/http-api.md; handlers do
// parse -> createPlan -> serialize, nothing else.

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get('/v1/health', async () => ({ status: 'ok' }));

  app.post('/v1/plans', async (request, reply) => {
    try {
      const plan = createPlan(request.body as CreatePlanRequest);
      return await reply.code(200).send(plan);
    } catch (error) {
      if (error instanceof ZodError) {
        const issue = error.issues[0];
        const path = issue !== undefined && issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
        return reply.code(400).send({
          error: {
            code: 'invalid_request',
            message: `${path}${issue?.message ?? 'invalid request'}`,
          },
        });
      }
      request.log?.error?.(error);
      return reply.code(500).send({
        error: { code: 'internal_error', message: 'Unexpected planning error' },
      });
    }
  });

  return app;
}
