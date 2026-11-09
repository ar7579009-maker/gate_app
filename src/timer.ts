// Focus timer. Time is measured against the wall clock (Date.now), not by counting ticks,
// so the result stays correct when Android pauses the WebView in the background.

export type TimerState = 'idle' | 'running' | 'paused';

export class FocusTimer {
  private state: TimerState = 'idle';
  private startedAt = 0;
  private accumulatedMs = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get status(): TimerState {
    return this.state;
  }

  start(): void {
    if (this.state === 'running') return;
    this.startedAt = this.now();
    this.state = 'running';
  }

  pause(): void {
    if (this.state !== 'running') return;
    this.accumulatedMs += this.now() - this.startedAt;
    this.state = 'paused';
  }

  /** Total studied time in whole seconds, including the current run. */
  elapsedSeconds(): number {
    const live = this.state === 'running' ? this.now() - this.startedAt : 0;
    return Math.max(0, Math.floor((this.accumulatedMs + live) / 1000));
  }

  /** Wall-clock time the session first started (epoch ms), or 0 if it never ran. */
  sessionStart(): number {
    return this.firstStart;
  }

  private firstStart = 0;

  /** Stops the timer and returns the session length in seconds. */
  stop(): number {
    const secs = this.elapsedSeconds();
    this.state = 'idle';
    this.accumulatedMs = 0;
    this.startedAt = 0;
    this.firstStart = 0;
    return secs;
  }

  /** Same as start(), but remembers when the whole session began. */
  begin(): void {
    if (this.state === 'idle') this.firstStart = this.now();
    this.start();
  }
}
