const ACTIONS = new Set(['setEnabled', 'checkUpdates', 'update', 'health', 'activate']);
const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

export function publicError(error) {
  return String(error?.message || error || 'Operation failed').slice(0, 2000)
    .replace(/sk-[A-Za-z0-9_-]+/g, '[redacted]')
    .replace(/([?&](?:token|key|secret)=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi, '$1[redacted]');
}

export function createApiHandler(manager) {
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: HEADERS });
  return async function fetch(request) {
    try {
      if (request.method === 'GET') return json({ ok: true, value: await manager.state() });
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const origin = request.headers.get('origin');
      if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
        return json({ ok: false, error: 'Cross-origin requests are not allowed.' }, 403);
      }
      if (request.headers.get('X-DSH-Computer-Use-Manager') !== '1' || !/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) {
        return json({ ok: false, error: 'Invalid request headers.' }, 403);
      }
      const text = await request.text();
      if (text.length > 4096) return json({ ok: false, error: 'Request is too large.' }, 413);
      let args;
      try { args = JSON.parse(text); } catch { return json({ ok: false, error: 'Invalid JSON.' }, 400); }
      if (!args || Array.isArray(args) || typeof args !== 'object' || !ACTIONS.has(args.action)) {
        return json({ ok: false, error: 'Unknown action.' }, 400);
      }
      const keys = ['action', ...(args.action === 'setEnabled' ? ['enabled'] : args.action === 'activate' ? ['installVersion', 'approvalId'] : [])];
      if (Object.keys(args).some(key => !keys.includes(key)) || (args.action === 'setEnabled' && typeof args.enabled !== 'boolean')) {
        return json({ ok: false, error: 'Invalid action arguments.' }, 400);
      }
      const approved = args.action === 'activate' && Object.hasOwn(args, 'approvalId');
      if (args.action === 'activate' && (Object.hasOwn(args, 'installVersion') !== approved || (approved &&
          (typeof args.installVersion !== 'string' || !args.installVersion.trim() || args.installVersion.length > 120 ||
           typeof args.approvalId !== 'string' || !args.approvalId.trim() || args.approvalId.length > 160)))) {
        return json({ ok: false, error: 'Invalid activation approval arguments.' }, 400);
      }
      return json({ ok: true, value: await manager.start(args.action, args) });
    } catch (error) {
      return json({ ok: false, error: publicError(error) }, error?.code === 'busy' ? 409 : 400);
    }
  };
}
