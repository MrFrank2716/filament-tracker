/*
 * Saves one setting at a time. Quick changes would otherwise send overlapping requests, and the server could
 * apply an older one last, so the older choice would come back after a reload. While a save is running only the
 * newest change waits; it is sent when the running one finishes, so the last change is always the one stored.
 */

export interface SaveHandlers<R> {
  /** The last save of a burst succeeded, with the server's reply. */
  onSaved: (reply: R) => void;
  /** The last save of a burst failed. `lastSaved` is the newest reply the server confirmed during the burst, if any. */
  onFailed: (error: unknown, lastSaved: R | undefined) => void;
}

export class SerialSaver<T, R> {
  private running = false;
  private next: { value: T; handlers: SaveHandlers<R> } | null = null;
  private confirmed: R | undefined;

  constructor(private readonly send: (value: T) => Promise<R>) {}

  /** True while a save is running; a change made now joins the current burst. */
  get busy(): boolean {
    return this.running;
  }

  save(value: T, handlers: SaveHandlers<R>): void {
    if (this.running) {
      this.next = { value, handlers };
      return;
    }
    this.running = true;
    this.confirmed = undefined;
    void this.run(value, handlers);
  }

  private async run(value: T, handlers: SaveHandlers<R>): Promise<void> {
    let reply: R | undefined;
    let failure: { error: unknown } | null = null;
    try {
      reply = await this.send(value);
      this.confirmed = reply;
    } catch (error) {
      failure = { error };
    }
    // A newer change is waiting: send it, and leave the screen showing it whatever this reply said.
    const waiting = this.next;
    if (waiting) {
      this.next = null;
      return this.run(waiting.value, waiting.handlers);
    }
    this.running = false;
    if (failure) handlers.onFailed(failure.error, this.confirmed);
    else handlers.onSaved(reply as R);
  }
}
