import { createRuntime, sessionID } from '../lib/review-loop.js';

export default async context => {
  if (/^(0|false|off)$/i.test(process.env.OPENCODE_MARK_REVIEW ?? '')) return {};
  const runtime = await createRuntime(context);
  if (!runtime) return {};
  let active = null;
  const mark = async (sid, files) => {
    if (!sessionID(sid)) return;
    try { await runtime.mark(sid, files); }
    catch { await runtime.warn('review-marker-write-failed; manual review required'); }
  };
  return {
    dispose: runtime.dispose,
    event: async ({ event }) => {
      if (event?.type === 'message.updated') {
        active = sessionID(event.properties?.info?.sessionID) ?? active;
        return;
      }
      if (!runtime.config.watchEvents.includes(event?.type)) return;
      const props = event.properties ?? {};
      await mark(sessionID(props.sessionID) ?? active, [props.file, props.path, props.oldPath, props.newPath]);
    },
    'tool.execute.after': async (input, output) => {
      if (!['edit', 'write', 'apply_patch', 'patch', 'multiedit'].includes(input?.tool)) return;
      const args = input.args ?? {};
      const files = [args.filePath, args.path];
      if (Array.isArray(output?.metadata?.files)) for (const file of output.metadata.files) files.push(file?.filePath, file?.movePath);
      if (typeof args.patchText === 'string') for (const match of args.patchText.matchAll(/^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm)) files.push(match[1]);
      await mark(input.sessionID, files);
    }
  };
};
