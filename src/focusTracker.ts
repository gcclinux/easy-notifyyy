import { NotificationMode } from './types';

export class FocusStateTracker {
  private windowFocused: boolean;
  private lastActivityMs: number;

  constructor(initialFocused = true, nowMs = Date.now()) {
    this.windowFocused = initialFocused;
    this.lastActivityMs = nowMs;
  }

  get isWindowFocused(): boolean {
    return this.windowFocused;
  }

  get lastActivityTimestamp(): number {
    return this.lastActivityMs;
  }

  recordActivity(nowMs = Date.now()): void {
    this.lastActivityMs = nowMs;
  }

  setWindowFocused(focused: boolean, nowMs = Date.now()): void {
    this.windowFocused = focused;
    if (focused) {
      this.lastActivityMs = nowMs;
    }
  }

  shouldNotify(
    mode: NotificationMode,
    idleSeconds: number,
    nowMs = Date.now()
  ): boolean {
    if (mode === 'muted') {
      return false;
    }
    if (mode === 'always') {
      return true;
    }
    if (!this.windowFocused) {
      return true;
    }
    const elapsedMs = nowMs - this.lastActivityMs;
    return elapsedMs >= idleSeconds * 1000;
  }
}
