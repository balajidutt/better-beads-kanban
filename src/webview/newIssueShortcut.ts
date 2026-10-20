import { z } from 'zod';

const HostShortcutMessageSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ui.newIssue') }).strict(),
    z.object({
        type: z.literal('ui.focus.request'),
        payload: z.object({ generation: z.uuid() }).strict()
    }).strict()
]);

export function buildFocusReadyMessage(requestId: string) {
    return { type: 'ui.focus.ready' as const, requestId };
}

export function buildFocusReportMessage(requestId: string, generation: string, sequence: number, focused: boolean) {
    return { type: 'ui.focus' as const, requestId, payload: { generation, sequence, focused } };
}

export interface ShortcutUiState {
    focused: boolean;
    visible: boolean;
    initialized: boolean;
    readOnly: boolean;
    typing: boolean;
    modalOpen: boolean;
}

interface ShortcutEventTarget {
    addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
    removeEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

interface ShortcutUiDependencies {
    window: ShortcutEventTarget;
    document: ShortcutEventTarget;
    state(): ShortcutUiState;
    requestId(): string;
    send(message: ReturnType<typeof buildFocusReadyMessage> | ReturnType<typeof buildFocusReportMessage>): void;
    newIssue(): void;
}

export function canOpenNewIssue(state: ShortcutUiState): boolean {
    return state.focused && state.visible && state.initialized && !state.readOnly && !state.typing && !state.modalOpen;
}

export function installNewIssueShortcut(deps: ShortcutUiDependencies): () => void {
    let disposed = false;
    let generation: string | null = null;
    let sequence = 0;
    let lastFocused: boolean | undefined;

    function report(force = false, hiding = false): void {
        if (disposed || generation === null || sequence > Number.MAX_SAFE_INTEGER) { return; }
        const state = deps.state();
        const focused = !hiding && state.focused && state.visible;
        if (!force && focused === lastFocused) { return; }
        lastFocused = focused;
        deps.send(buildFocusReportMessage(deps.requestId(), generation, sequence++, focused));
    }

    const focusChanged = () => report();
    const pageHidden = () => { report(false, true); dispose(); };
    const message = (event: { data?: unknown }) => {
        if (disposed) { return; }
        if (z.object({ type: z.literal('webview.cleanup') }).strict().safeParse(event.data).success) {
            dispose();
            return;
        }
        const parsed = HostShortcutMessageSchema.safeParse(event.data);
        if (!parsed.success) { return; }
        if (parsed.data.type === 'ui.focus.request') {
            if (generation !== parsed.data.payload.generation) {
                generation = parsed.data.payload.generation;
                sequence = 0;
                lastFocused = undefined;
            }
            report(true);
        } else if (canOpenNewIssue(deps.state())) {
            deps.newIssue();
        }
    };

    function dispose(): void {
        if (disposed) { return; }
        disposed = true;
        generation = null;
        deps.window.removeEventListener('message', message);
        deps.window.removeEventListener('focus', focusChanged);
        deps.window.removeEventListener('blur', focusChanged);
        deps.window.removeEventListener('pagehide', pageHidden);
        deps.document.removeEventListener('visibilitychange', focusChanged);
    }

    deps.window.addEventListener('message', message);
    deps.window.addEventListener('focus', focusChanged);
    deps.window.addEventListener('blur', focusChanged);
    deps.window.addEventListener('pagehide', pageHidden);
    deps.document.addEventListener('visibilitychange', focusChanged);
    deps.send(buildFocusReadyMessage(deps.requestId()));
    return dispose;
}
