import { ComputerUseManager } from './core.js';
import { createApiHandler, redactForModel } from './api.js';

export const name = 'local-computer-use-manager';
export const inject = ['connection', 'pluginManager', 'tools', 'loader'];

export function apply(ctx) {
  const manager = new ComputerUseManager(ctx);
  ctx.effect(() => () => manager.dispose());
  ctx.effect(() => ctx.tools.register({
    name: 'computer_use_status',
    description: 'Read computer-use configured and live state, versions, latest health check, and management operation results. Does not change settings or send desktop input. Installation approval tokens are withheld; only the user can confirm installation in the manager page.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async () => redactForModel(await manager.state()),
  }));
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/computer-use-manager',
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    fetch: createApiHandler(manager),
  }));
}
