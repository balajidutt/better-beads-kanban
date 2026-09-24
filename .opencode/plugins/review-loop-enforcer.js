import { createRuntime, sessionID, reviewRequest } from '../lib/review-loop.js';

export default async context => {
  if (/^(0|false|off)$/i.test(process.env.OPENCODE_ENFORCE_REVIEW ?? '')) return {};
  const runtime = await createRuntime(context);
  if (!runtime) return {};
  const agents = new Map();
  const blocked = new Set();
  const timers = new Map();
  const inflight = new Set();
  let disposed = false;
  const enforce = async sid => {
    if (disposed || inflight.has(sid) || blocked.has(sid)) return;
    inflight.add(sid);
    try {
      const gate = await runtime.gate(sid);
      if (!gate) return;
      const state = await runtime.load(sid, 'delivery');
      if (state?.revision === gate.revision && ['delivered', 'unknown'].includes(state.status)) return;
      const get = context.client?.session?.get;
      const meta = await runtime.call(get?.bind(context.client.session), { path: { id: sid }, query: { directory: runtime.base } });
      const info = meta.response?.data;
      const agent = agents.get(sid) ?? info?.agent;
      if (disposed || blocked.has(sid) || meta.kind !== 'returned' || info?.id !== sid || info.parentID || !agent || agent === runtime.config.reviewerAgent) return;
      const prompt = context.client?.session?.promptAsync;
      if (typeof prompt !== 'function') { await runtime.warn('review-delivery-unavailable; manual review required'); return; }
      await runtime.serial(sid, () => runtime.save(sid, 'delivery', { revision: gate.revision, status: 'unknown' }));
      const result = await runtime.call(prompt.bind(context.client.session), {
        path: { id: sid }, query: { directory: runtime.base },
        body: { parts: [{ type: 'text', text: reviewRequest(runtime.config, sid, gate.revision) }] }
      });
      const status = result.response?.response?.status;
      const delivered = result.kind === 'returned' && status >= 200 && status < 300;
      const rejected = result.kind === 'rejected' && [400, 401, 403, 404, 422].includes(status);
      if (!disposed) await runtime.serial(sid, () => runtime.save(sid, 'delivery', { revision: gate.revision, status: delivered ? 'delivered' : rejected ? 'rejected' : 'unknown' }));
      if (!delivered) await runtime.warn(rejected ? 'review-delivery-rejected; pending review retained' : 'review-delivery-uncertain; no automatic retry');
    } catch { await runtime.warn('review-enforcement-unavailable; pending review retained'); }
    finally { inflight.delete(sid); }
  };
  return {
    dispose: async () => { disposed = true; for (const timer of timers.values()) clearTimeout(timer); timers.clear(); agents.clear(); blocked.clear(); await runtime.dispose(); },
    event: async ({ event }) => {
      const sid = sessionID(event?.properties?.sessionID ?? event?.properties?.info?.sessionID);
      if (!sid || disposed) return;
      if (event.type === 'session.error' || event.type === 'message.updated' && event.properties.info?.error) { if (blocked.size < 256) blocked.add(sid); return; }
      if (event.type === 'message.updated') {
        const info = event.properties.info;
        if (info?.role === 'user' && typeof info.agent === 'string' && agents.size < 256) agents.set(sid, info.agent);
        return;
      }
      if (event.type !== 'session.idle' || blocked.has(sid)) return;
      if (!timers.has(sid) && timers.size >= 256) return;
      clearTimeout(timers.get(sid));
      const timer = setTimeout(() => { timers.delete(sid); void enforce(sid); }, runtime.config.debounceMs);
      timer.unref?.();
      timers.set(sid, timer);
    }
  };
};
