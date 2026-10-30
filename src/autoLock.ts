export class AutoLockScheduler {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  schedule(id: string, confirmedAt: number, onDue: () => void) {
    this.cancel(id);
    const timer = setTimeout(() => {
      this.timers.delete(id);
      onDue();
    }, Math.max(0, confirmedAt + 6000 - Date.now()));
    this.timers.set(id, timer);
  }

  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (timer === undefined) return false;
    clearTimeout(timer);
    this.timers.delete(id);
    return true;
  }
}
