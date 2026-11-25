import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { db, type Lock } from '../src/database';
import { COMMAND, NOTIFY, SERVICE } from '../src/protocol';
import { operate, refresh, reselect, select } from '../src/service';

function peripheral(id: string, name: string, reply = 3) {
  const notifications = Object.assign(new EventTarget(), {
    properties: { notify: true },
    startNotifications: vi.fn().mockResolvedValue(undefined), stopNotifications: vi.fn().mockResolvedValue(undefined),
    value: new DataView(Uint8Array.of(reply).buffer),
  });
  const write = vi.fn(async () => notifications.dispatchEvent(new Event('characteristicvaluechanged')));
  const service = { getCharacteristic: async (uuid: string) => {
    if (uuid === COMMAND) return { properties: { write: true }, writeValueWithResponse: write };
    if (uuid === NOTIFY) return notifications;
    throw Error('Unknown characteristic');
  } };
  const gatt = {
    connected: false,
    connect: vi.fn(async () => { gatt.connected = true; return gatt; }),
    disconnect: () => { gatt.connected = false; },
    getPrimaryService: async (uuid: string) => {
      if (uuid === SERVICE) return service;
      throw Error('Unsupported service');
    },
  };
  return { device: Object.assign(new EventTarget(), { id, name, gatt }), write };
}

let lock: Lock;
const key = '00112233445566778899aabbccddeeff';
beforeEach(async () => {
  await db.locks.clear(); await db.credentials.clear(); await db.operations.clear();
  lock = { id: crypto.randomUUID(), bluetoothDeviceId: 'original', name: 'Left cabinet',
    serialNumber: 'B2ib832p', autoLock: false, batteryLevel: 80, batteryUpdatedAt: 10,
    lastConnectedAt: 20, createdAt: 1, model: 'M02' };
  await db.locks.add(lock);
  await db.credentials.add({ lockId: lock.id, signKey: key });
});
afterEach(() => vi.unstubAllGlobals());

it('shows compatible devices when adding a lock', async () => {
  const requestDevice = vi.fn().mockResolvedValue(peripheral('new', 'EL_B2ib832p').device);
  vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
  await select();
  expect(requestDevice).toHaveBeenCalledWith({
    filters: [{ services: [SERVICE] }, { namePrefix: 'EL_' }],
    optionalServices: [SERVICE, 'battery_service'],
  });
});

it('uses the already authorized device with the saved serial after a restart', async () => {
  const { device, write } = peripheral('renewed', 'EL_B2ib832p');
  const requestDevice = vi.fn();
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [device], requestDevice } });
  await refresh();
  expect((await operate(lock, 1)).result).toBe('confirmed');
  expect(requestDevice).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledOnce();
  expect(await db.locks.toArray()).toEqual([expect.objectContaining({
    ...lock, bluetoothDeviceId: 'renewed', lastConnectedAt: expect.any(Number),
  })]);
  expect(await db.credentials.toArray()).toEqual([{ lockId: lock.id, signKey: key }]);
  // Reopen with no in-memory BluetoothDevice. Only IndexedDB and Chrome's
  // device grants survive. The confirmed ID takes priority over another name match.
  const other = peripheral('other', device.name);
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [other.device, device], requestDevice } });
  vi.resetModules();
  const reopened = await import('../src/service');
  await reopened.refresh();
  const [saved] = reopened.useLocks.getState().locks;
  expect((await reopened.operate(saved, 1)).result).toBe('confirmed');
  expect(requestDevice).not.toHaveBeenCalled();
  expect(write).toHaveBeenCalledTimes(2);
  expect(other.write).not.toHaveBeenCalled();
});

it('accepts a new ID in the chooser for the saved serial without a setup unlock', async () => {
  const { device, write } = peripheral('renewed', 'EL_B2ib832p');
  const requestDevice = vi.fn().mockResolvedValue(device);
  vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
  await refresh();
  await reselect(lock);
  expect(requestDevice).toHaveBeenCalledWith({
    filters: [{ name: 'EL_B2ib832p' }],
    optionalServices: [SERVICE, 'battery_service'],
  });
  expect(device.gatt.connect).toHaveBeenCalledOnce();
  expect(write).not.toHaveBeenCalled();
  expect((await db.locks.get(lock.id))?.bluetoothDeviceId).toBe('original');
  await operate(lock, 1);
  expect(requestDevice).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledOnce();
  expect((await db.locks.get(lock.id))?.bluetoothDeviceId).toBe('renewed');
});

it('opens the chooser directly from Unlock when Chrome cannot restore permissions', async () => {
  const { device, write } = peripheral('renewed', 'EL_B2ib832p');
  const requestDevice = vi.fn().mockResolvedValue(device);
  vi.stubGlobal('navigator', { bluetooth: { requestDevice } });
  await refresh();
  const operation = operate(lock, 1);
  expect(requestDevice).toHaveBeenCalledOnce(); // Still inside the tap.
  expect(requestDevice).toHaveBeenCalledWith({
    filters: [{ name: 'EL_B2ib832p' }],
    optionalServices: [SERVICE, 'battery_service'],
  });
  expect((await operation).result).toBe('confirmed');
  expect(write).toHaveBeenCalledOnce();
  await operate(lock, 1);
  expect(requestDevice).toHaveBeenCalledOnce();
});

it('leaves registration intact when selection is cancelled or another lock is chosen', async () => {
  const wrong = peripheral('other', 'EL_B2ib832pX');
  const requestDevice = vi.fn().mockRejectedValueOnce(new DOMException('Cancelled', 'NotFoundError'))
    .mockResolvedValue(wrong.device);
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [wrong.device], requestDevice } });
  await refresh();
  await expect(operate(lock, 1)).rejects.toThrow('Cancelled');
  await expect(operate(lock, 1)).rejects.toThrow('EL_B2ib832p');
  expect(wrong.device.gatt.connect).not.toHaveBeenCalled();
  expect(await db.locks.get(lock.id)).toEqual(lock);
  expect(await db.operations.count()).toBe(0);
});

it('requires a choice between multiple authorized serial matches and keeps the old ID on rejection', async () => {
  const a = peripheral('a', 'EL_B2ib832p');
  const b = peripheral('b', 'EL_B2ib832p', 0xff);
  const requestDevice = vi.fn().mockResolvedValue(b.device);
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [a.device, b.device], requestDevice } });
  await refresh();
  expect((await operate(lock, 1)).result).toBe('rejected');
  expect(requestDevice).toHaveBeenCalledOnce();
  expect(a.write).not.toHaveBeenCalled();
  expect(b.write).toHaveBeenCalledOnce();
  expect((await db.locks.get(lock.id))?.bluetoothDeviceId).toBe('original');
});

it('keeps devices belonging to another saved lock out of a changed-ID binding', async () => {
  const { device, write } = peripheral('reserved', 'EL_B2ib832p');
  await db.locks.add({ ...lock, id: 'other', bluetoothDeviceId: 'reserved', serialNumber: 'AnotherSN' });
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [device] } });
  await refresh();
  await expect(operate(lock, 1)).rejects.toThrow('another saved lock');
  expect(write).not.toHaveBeenCalled();
  expect((await db.locks.get(lock.id))?.bluetoothDeviceId).toBe('original');
});

it('can use the other granted handle on the next tap when the saved ID is unreachable', async () => {
  const stale = peripheral('original', 'EL_B2ib832p');
  const current = peripheral('renewed', 'EL_B2ib832p');
  stale.device.gatt.connect.mockRejectedValue(new DOMException('Out of range', 'NetworkError'));
  const requestDevice = vi.fn();
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [stale.device, current.device], requestDevice } });
  await refresh();
  await expect(operate(lock, 1)).rejects.toThrow('Out of range');
  expect(current.write).not.toHaveBeenCalled();
  expect((await operate(lock, 1)).result).toBe('confirmed');
  expect(stale.write).not.toHaveBeenCalled();
  expect(current.write).toHaveBeenCalledOnce();
  expect(requestDevice).not.toHaveBeenCalled();
});

it('keeps the old binding and sends only one command after an ambiguous write failure', async () => {
  const { device, write } = peripheral('renewed', 'EL_B2ib832p');
  write.mockRejectedValue(new DOMException('Disconnected', 'NetworkError'));
  const requestDevice = vi.fn();
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [device], requestDevice } });
  await refresh();
  expect((await operate(lock, 1)).result).toBe('unknown');
  expect(write).toHaveBeenCalledOnce();
  expect(requestDevice).not.toHaveBeenCalled();
  expect((await db.locks.get(lock.id))?.bluetoothDeviceId).toBe('original');
});

it('never opens the chooser or switches to a serial match for a scheduled lock command', async () => {
  const { device, write } = peripheral('renewed', 'EL_B2ib832p');
  const requestDevice = vi.fn();
  vi.stubGlobal('navigator', { bluetooth: { getDevices: async () => [device], requestDevice } });
  await refresh();
  await expect(operate(lock, 2, 'auto-lock')).rejects.toThrow('unavailable');
  expect(write).not.toHaveBeenCalled();
  expect(requestDevice).not.toHaveBeenCalled();
});
