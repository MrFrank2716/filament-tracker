import { diffMergePatch, mergeDelta, touchesPaths, withoutPaths, type Doc, type PrinterReport, type ReportAck, type TelemetryConfig } from '@filament-tracker/protocol';

/**
 * Keeps the server's copy of one printer's status document in step with ours.
 *
 * Printers report every second or so. Rather than pass all of that on, the bridge folds each message into one
 * document and sends the server the difference since the last thing it acknowledged: one report in flight at
 * a time, never faster than the agreed gap (unless something that matters changed), and everything that
 * happens while waiting collapses into the next report.
 */

export interface ReplicatorLink {
  /** True while the bridge is connected to the server and has said hello. */
  ready(): boolean;
  /** Resolves with the server's answer, or null if it did not answer. */
  send(report: PrinterReport): Promise<ReportAck | null>;
  telemetry(): TelemetryConfig;
  /** The slowest gap between reports right now (shorter while someone is watching). */
  gapMs(): number;
}

export class Replicator {
  private doc: Doc = {};
  /** What the server holds, as far as we know; null means "send everything". */
  private acknowledged: Doc | null = null;
  private seq = 0;
  private inFlight = false;
  private lastSentAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly printerId: string,
    private readonly link: ReplicatorLink,
  ) {}

  /** Fold one message from the printer into the document. */
  merge(delta: Doc): void {
    this.doc = mergeDelta(this.doc, delta, this.link.telemetry().arrayKey) as Doc;
    this.kick();
  }

  /** A new connection to the server: numbering starts again and the first report is the whole document. */
  restart(): void {
    this.acknowledged = null;
    this.seq = 0;
    this.kick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  kick(): void {
    if (this.stopped || this.inFlight || !this.link.ready()) return;
    const telemetry = this.link.telemetry();
    const view = withoutPaths(this.doc, telemetry.ignorePaths);
    if (Object.keys(view).length === 0) return;
    if (this.acknowledged === null) return void this.transmit('full', view, view);
    const patch = diffMergePatch(this.acknowledged, view);
    if (patch === undefined) return;
    const wait = touchesPaths(patch, telemetry.urgentPaths) ? 0 : this.link.gapMs() - (Date.now() - this.lastSentAt);
    if (wait > 0) return this.later(wait);
    void this.transmit('patch', patch as Doc, view);
  }

  private later(ms: number): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.kick();
    }, ms);
  }

  private async transmit(kind: 'full' | 'patch', data: Doc, view: Doc): Promise<void> {
    this.inFlight = true;
    const reply = await this.link.send({ printerId: this.printerId, seq: this.seq++, kind, data }).catch(() => null);
    this.inFlight = false;
    this.lastSentAt = Date.now();
    if (reply?.ok) {
      this.acknowledged = view;
      this.kick();
    } else {
      // No answer, or the server lost track: start over with the whole document, after a breath.
      this.acknowledged = null;
      this.later(reply ? 0 : 2000);
    }
  }
}
