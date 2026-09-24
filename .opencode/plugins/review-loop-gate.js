import { createRuntime, sessionID, reviewDecision } from '../lib/review-loop.js';

export default async context => {
  const runtime = await createRuntime(context);
  if (!runtime) return {};
  const requests = new Map();
  const key = input => JSON.stringify([input.sessionID, input.callID]);
  const callID = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
  return {
    dispose: async () => { requests.clear(); await runtime.dispose(); },
    'tool.execute.before': async (input, output) => {
      if (input?.tool !== 'task' || output?.args?.subagent_type !== runtime.config.reviewerAgent || !sessionID(input.sessionID) || !callID(input.callID)) return;
      try {
        const gate = await runtime.gate(input.sessionID);
        if (gate && requests.size < 128) requests.set(key(input), { sid: input.sessionID, revision: gate.revision });
      } catch { await runtime.warn('review-target-unavailable; pending review retained'); }
    },
    'tool.execute.after': async (input, output) => {
      if (!input) return;
      const request = requests.get(key(input));
      requests.delete(key(input));
      if (!request || input.tool !== 'task' || input.args?.subagent_type !== runtime.config.reviewerAgent || reviewDecision(output?.output, runtime.config.resultMarkerPrefix) !== 'PASS') return;
      try { await runtime.clear(request.sid, request.revision); }
      catch { await runtime.warn('review-gate-clear-failed; manual reconciliation required'); }
    }
  };
};
