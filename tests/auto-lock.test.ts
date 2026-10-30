import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AutoLockScheduler } from '../src/autoLock';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
afterEach(() => vi.useRealTimers());

it('starts six seconds after confirmation, accounting for time already elapsed', () => {
  const scheduler = new AutoLockScheduler();
  const lock = vi.fn();
  vi.setSystemTime(12_000);
  scheduler.schedule('a', 10_000, lock);
  vi.advanceTimersByTime(3999);
  expect(lock).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(lock).toHaveBeenCalledOnce();
});

it('cancels and replaces timers per lock independently', () => {
  const scheduler = new AutoLockScheduler();
  const oldLock = vi.fn(); const newLock = vi.fn(); const otherLock = vi.fn();
  scheduler.schedule('a', Date.now(), oldLock);
  scheduler.schedule('b', Date.now(), otherLock);
  scheduler.schedule('a', Date.now(), newLock);
  expect(scheduler.cancel('b')).toBe(true);
  vi.advanceTimersByTime(6000);
  expect(oldLock).not.toHaveBeenCalled();
  expect(otherLock).not.toHaveBeenCalled();
  expect(newLock).toHaveBeenCalledOnce();
  expect(scheduler.cancel('a')).toBe(false);
});
