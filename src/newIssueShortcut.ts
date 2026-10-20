import { z } from 'zod';

const RequestIdSchema = z.string().min(1).max(128);
const GenerationSchema = z.uuid();

export const FocusReadyMessageSchema = z.object({
  type: z.literal('ui.focus.ready'),
  requestId: RequestIdSchema
}).strict();

export const FocusReportMessageSchema = z.object({
  type: z.literal('ui.focus'),
  requestId: RequestIdSchema,
  payload: z.object({
    generation: GenerationSchema,
    sequence: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    focused: z.boolean()
  }).strict()
}).strict();

export type ShortcutHostMessage =
  | { type: 'ui.newIssue' }
  | { type: 'ui.focus.request'; payload: { generation: string } };

export interface ShortcutPanel {
  readonly active: boolean;
  readonly visible: boolean;
  readonly webview: { postMessage(message: ShortcutHostMessage): PromiseLike<boolean> };
}

export interface ShortcutDependencies<P extends ShortcutPanel> {
  livePanels: ReadonlySet<P>;
  windowFocused: boolean;
  generation(): string;
  publishContext(focused: boolean): PromiseLike<unknown>;
  log(message: string): void;
  sanitizeError(error: unknown): string;
  now(): string;
}

interface PanelFocus {
  id: number;
  ready: boolean;
  generation: string | null;
  sequence: number;
  focused: boolean;
}

export class NewIssueShortcutController<P extends ShortcutPanel> {
  private readonly panels = new Map<P, PanelFocus>();
  private nextPanelId = 0;
  private windowFocused: boolean;
  private stopped = false;
  private wanted = false;
  private wantedRevision = 0;
  private published: boolean | undefined;
  private inFlight = false;

  constructor(private readonly deps: ShortcutDependencies<P>) {
    this.windowFocused = deps.windowFocused;
    this.updateContext();
  }

  private diagnostic(event: string): void {
    this.deps.log(`[Shortcut ${this.deps.now()}] ${event}`.slice(0, 512));
  }

  private error(event: string, error: unknown): void {
    this.diagnostic(`${event} error=${this.deps.sanitizeError(error).replace(/[\r\n]/g, ' ').slice(0, 200)}`);
  }

  private available(panel: P): boolean {
    return !this.stopped && this.deps.livePanels.has(panel) && panel.active && panel.visible && this.windowFocused;
  }

  private eligible(panel: P, state: PanelFocus): boolean {
    return this.available(panel) && state.generation !== null && state.focused;
  }

  private invalidate(state: PanelFocus): void {
    state.generation = null;
    state.sequence = -1;
    state.focused = false;
    this.diagnostic(`panel=${state.id} eligible=false sync=required`);
  }

  attach(panel: P): void {
    if (this.stopped || !this.deps.livePanels.has(panel) || this.panels.has(panel)) { return; }
    this.panels.set(panel, { id: ++this.nextPanelId, ready: false, generation: null, sequence: -1, focused: false });
    this.updateContext();
  }

  detach(panel: P): void {
    const state = this.panels.get(panel);
    if (!state || this.stopped) { return; }
    this.invalidate(state);
    this.panels.delete(panel);
    this.updateContext();
  }

  private requestFocus(panel: P, state: PanelFocus): void {
    const generation = this.deps.generation();
    state.generation = generation;
    this.diagnostic(`panel=${state.id} sync=requested`);
    void this.deliver(panel, { type: 'ui.focus.request', payload: { generation } }).then(delivered => {
      if (!delivered && this.panels.get(panel) === state && state.generation === generation && !this.stopped) {
        this.invalidate(state);
        this.updateContext();
      }
    });
  }

  panelChanged(panel: P): void {
    const state = this.panels.get(panel);
    if (!state || this.stopped) { return; }
    this.invalidate(state);
    this.updateContext();
    if (state.ready && this.available(panel)) { this.requestFocus(panel, state); }
  }

  windowChanged(focused: boolean): void {
    if (this.stopped) { return; }
    this.windowFocused = focused;
    for (const state of this.panels.values()) { this.invalidate(state); }
    this.updateContext();
    if (focused) {
      for (const [panel, state] of this.panels) {
        if (state.ready && this.available(panel)) { this.requestFocus(panel, state); }
      }
    }
  }

  handleMessage(panel: P, message: unknown): boolean {
    if (!message || typeof message !== 'object' || !('type' in message)) { return false; }
    if (message.type !== 'ui.focus.ready' && message.type !== 'ui.focus') { return false; }
    const state = this.panels.get(panel);
    if (this.stopped || !state || !this.deps.livePanels.has(panel)) { return true; }
    if (message.type === 'ui.focus.ready') {
      const parsed = FocusReadyMessageSchema.safeParse(message);
      if (!parsed.success) { return true; }
      this.invalidate(state);
      state.ready = true;
      this.updateContext();
      this.requestFocus(panel, state);
      return true;
    }
    const parsed = FocusReportMessageSchema.safeParse(message);
    if (!parsed.success) { return true; }
    const report = parsed.data.payload;
    if (report.generation !== state.generation || report.sequence <= state.sequence || !this.available(panel)) { return true; }
    state.sequence = report.sequence;
    state.focused = report.focused;
    this.diagnostic(`panel=${state.id} eligible=${state.focused} sequence=${state.sequence} sync=reported`);
    this.updateContext();
    return true;
  }

  async newIssue(): Promise<void> {
    if (this.stopped) { return; }
    for (const [panel, state] of this.panels) {
      if (this.eligible(panel, state)) {
        await this.deliver(panel, { type: 'ui.newIssue' });
        return;
      }
    }
  }

  private async deliver(panel: P, message: ShortcutHostMessage): Promise<boolean> {
    if (this.stopped || !this.deps.livePanels.has(panel)) { return false; }
    try {
      const delivered = await panel.webview.postMessage(message);
      if (!delivered) { this.diagnostic(`delivery=${message.type} status=false`); }
      return delivered;
    } catch (error) {
      this.error(`delivery=${message.type} status=error`, error);
      return false;
    }
  }

  private updateContext(): void {
    this.wanted = !this.stopped && [...this.panels].some(([panel, state]) => this.eligible(panel, state));
    this.wantedRevision++;
    this.diagnostic(`wanted revision=${this.wantedRevision} value=${this.wanted} inFlight=${this.inFlight}`);
    this.publish();
  }

  private publish(): void {
    if (this.inFlight) { return; }
    if (this.published === this.wanted) {
      this.diagnostic(`publication status=current revision=${this.wantedRevision} value=${this.published}`);
      return;
    }
    const value = this.wanted;
    const revision = this.wantedRevision;
    this.inFlight = true;
    this.diagnostic(`publication status=in-flight revision=${revision} value=${value}`);
    void this.performPublication(value, revision);
  }

  private async performPublication(value: boolean, revision: number): Promise<void> {
    try {
      await this.deps.publishContext(value);
    } catch (error) {
      this.published = undefined;
      this.inFlight = false;
      this.error(`publication status=error revision=${revision} wantedRevision=${this.wantedRevision}`, error);
      return;
    }
    this.inFlight = false;
    this.published = value;
    this.diagnostic(`publication status=success revision=${revision} value=${value} wantedRevision=${this.wantedRevision}`);
    this.publish();
  }

  dispose(): void {
    if (this.stopped) { return; }
    this.stopped = true;
    for (const state of this.panels.values()) { this.invalidate(state); }
    this.panels.clear();
    this.updateContext();
  }
}
