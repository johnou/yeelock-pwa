import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { db, type Lock } from '../src/database';
import { Transport } from '../src/bluetooth';
import { operate, rename, setAutoLock, useLocks } from '../src/service';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const lock: Lock = { id: 'test-lock', bluetoothDeviceId: 'bt', name: 'Cabinet', autoLock: false, model: 'M02', serialNumber: '12345678', batteryLevel: null, batteryUpdatedAt: null, lastConnectedAt: null, createdAt: 1 };
const device = { id: 'bt', addEventListener() {}, removeEventListener() {} };

beforeEach(async () => {
  vi.stubGlobal('document', { visibilityState: 'visible' });
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [device] } });
  await db.locks.clear(); await db.credentials.clear(); await db.operations.clear();
  await db.locks.add(lock); await db.credentials.add({ lockId: lock.id, signKey: '00112233445566778899aabbccddeeff' });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('persists renaming and the auto-lock setting without changing credentials', async () => {
  await rename(lock, '  Desk  ');
  await setAutoLock(lock, true);
  expect(await db.locks.get(lock.id)).toMatchObject({ name: 'Desk', autoLock: true });
  expect(await db.credentials.get(lock.id)).toEqual({ lockId: lock.id, signKey: '00112233445566778899aabbccddeeff' });
  await expect(rename(lock, '  ')).rejects.toThrow('Enter a lock name');
});

it('schedules one lock after a confirmed unlock', async () => {
  let notify: (value: DataView) => void = () => {};
  vi.spyOn(Transport.prototype, 'connect').mockResolvedValue();
  vi.spyOn(Transport.prototype, 'listen').mockImplementation(async handler => { notify = handler; return () => {}; });
  const write = vi.spyOn(Transport.prototype, 'write').mockImplementation(async data => { notify(new DataView(Uint8Array.of(data[6] === 1 ? 3 : 5).buffer)); });
  vi.spyOn(Transport.prototype, 'battery').mockResolvedValue(null);
  vi.spyOn(Transport.prototype, 'close').mockImplementation(() => {});
  await setAutoLock(lock, true);
  await operate({ ...lock, autoLock: true }, 1);
  expect(write.mock.calls.map(call => call[0][6])).toEqual([1]);
  expect(useLocks.getState().scheduled[lock.id]).toBe(true);
  await vi.waitFor(() => expect(write.mock.calls.map(call => call[0][6])).toEqual([1, 2]), { timeout: 8000, interval: 50 });
  await vi.waitFor(() => expect(useLocks.getState().results[lock.id]).toContain('Lock confirmed'), { timeout: 1000, interval: 50 });
}, 10000);

it('does not schedule auto-lock when the unlock is rejected', async () => {
  let notify: (value: DataView) => void = () => {};
  vi.spyOn(Transport.prototype, 'connect').mockResolvedValue();
  vi.spyOn(Transport.prototype, 'listen').mockImplementation(async handler => { notify = handler; return () => {}; });
  const write = vi.spyOn(Transport.prototype, 'write').mockImplementation(async () => { notify(new DataView(Uint8Array.of(0xff).buffer)); });
  vi.spyOn(Transport.prototype, 'battery').mockResolvedValue(null);
  vi.spyOn(Transport.prototype, 'close').mockImplementation(() => {});
  await setAutoLock(lock, true);
  const result = await operate({ ...lock, autoLock: true }, 1);
  expect(result.result).toBe('rejected');
  expect(useLocks.getState().scheduled[lock.id]).toBeFalsy();
  expect(write).toHaveBeenCalledOnce();
});

it('recovers an authorized saved device before reconnect is selected', async () => {
  const requestDevice = vi.fn();
  const saved = { ...lock, id: 'another-lock', bluetoothDeviceId: 'other-bt' };
  await db.locks.add(saved);
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [{ ...device, id: 'other-bt' }], requestDevice } });
  const { refresh, reselect } = await import('../src/service');
  await refresh();
  await reselect(saved);
  expect(requestDevice).not.toHaveBeenCalled();
});

it('enables auto-lock for newly added locks and schedules it after verification', async () => {
  let notify: (value: DataView) => void = () => {};
  vi.spyOn(Transport.prototype, 'connect').mockResolvedValue();
  vi.spyOn(Transport.prototype, 'listen').mockImplementation(async handler => { notify = handler; return () => {}; });
  vi.spyOn(Transport.prototype, 'write').mockImplementation(async () => { notify(new DataView(Uint8Array.of(3).buffer)); });
  vi.spyOn(Transport.prototype, 'close').mockImplementation(() => {});
  const { register } = await import('../src/service');
  const added = await register({ ...device, id: 'new-bt' } as unknown as BluetoothDevice, 'New cabinet', '12345678', '00112233445566778899aabbccddeeff');
  expect(added.autoLock).toBe(true);
  expect((await db.locks.get(added.id))?.autoLock).toBe(true);
  expect(useLocks.getState().scheduled[added.id]).toBe(true);
  await setAutoLock(added, false);
  expect(useLocks.getState().scheduled[added.id]).toBe(false);
});
