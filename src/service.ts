import { create } from 'zustand';
import { db, type Lock } from './database';
import { AutoLockScheduler } from './autoLock';
import { chooseDevice, recoverDevice, Transport, TIMEOUT, deadline } from './bluetooth';
export { bluetoothSupportMessage } from './bluetooth';
import { notification, packet, parseKey, timePacket, type Result } from './protocol';
type Phase = 'disconnected' | 'connecting' | 'connected' | 'authenticating' | 'ready' | 'error';
type State = { locks: Lock[]; phases: Record<string, Phase>; pending: Record<string, boolean>; scheduled: Record<string, boolean>; results: Record<string, string>; set: (part: Partial<State>) => void };
export const useLocks = create<State>(set => ({ locks: [], phases: {}, pending: {}, scheduled: {}, results: {}, set }));
const selected = new Map<string, BluetoothDevice>();
const active = new Set<string>();
const autoLocks = new AutoLockScheduler();
const operationVersions = new Map<string, number>();
function setScheduled(id: string, value: boolean) { useLocks.getState().set({ scheduled: { ...useLocks.getState().scheduled, [id]: value } }); }
function resultMessage(id: string, message: string) { useLocks.getState().set({ results: { ...useLocks.getState().results, [id]: message } }); }
function cancelAutoLock(id: string) { if (autoLocks.cancel(id)) setScheduled(id, false); }
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    for (const [id, scheduled] of Object.entries(useLocks.getState().scheduled)) {
      if (scheduled) { cancelAutoLock(id); resultMessage(id, 'Auto-lock cancelled because the app left the foreground. Lock the cabinet manually.'); }
    }
  }
});
function phase(id: string, value: Phase) { useLocks.getState().set({ phases: { ...useLocks.getState().phases, [id]: value } }); }
export async function refresh() {
  const locks = await db.locks.toArray();
  useLocks.getState().set({ locks });
  await Promise.all(locks.map(async lock => {
    if (!selected.has(lock.id)) {
      try { const device = await recoverDevice(lock.bluetoothDeviceId); if (device) selected.set(lock.id, device); } catch { /* The chooser remains available if recovery fails. */ }
    }
  }));
}
export async function select() { return chooseDevice(); }
export async function reselect(lock: Lock) {
  if (selected.has(lock.id)) return;
  const device = await chooseDevice();
  if (device.id !== lock.bluetoothDeviceId) throw new Error('That is not the registered device. Select the original lock.');
  selected.set(lock.id, device);
}
export async function command(device: BluetoothDevice, id: string, key: string, action: 1 | 2, skipBattery = false): Promise<{ result: Result; battery: number | null; detail?: string; confirmedAt?: number }> {
  let sent = false; let stop: (() => void) | undefined;
  const transport = new Transport(device, () => phase(id, 'disconnected'));
  try {
    phase(id, 'connecting'); await transport.connect(); phase(id, 'connected');
    const data = await packet(parseKey(key), action);
    let finish: (value: Result | 'time') => void = () => {};
    const response = new Promise<Result | 'time'>(resolve => { finish = resolve; });
    stop = await transport.listen(value => { const status = notification(value, action); if (status) finish(status); });
    phase(id, 'authenticating'); sent = true;
    await deadline(transport.write(data), TIMEOUT.response, 'Command write');
    const result = await deadline(response, TIMEOUT.response, 'Device response');
    if (result === 'time') {
      await deadline(transport.write(await timePacket(parseKey(key))), TIMEOUT.response, 'Clock sync');
      await new Promise(resolve => setTimeout(resolve, 500));
      return { result: 'unknown', battery: null, detail: 'Clock sync was sent. The unlock result is unknown: check the cabinet, then try again.' };
    }
    const confirmedAt = result === 'confirmed' ? Date.now() : undefined;
    const battery = skipBattery ? null : await transport.battery();
    return { result, battery, confirmedAt };
  } catch (error) {
    if (sent) return { result: 'unknown', battery: null, detail: 'The command may have been sent, but its outcome could not be verified. Check the cabinet before trying again.' };
    throw error;
  } finally { stop?.(); transport.close(); phase(id, 'disconnected'); }
}
async function exclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
  if (active.has(id)) throw new Error('An operation is already in progress.');
  active.add(id); useLocks.getState().set({ pending: { ...useLocks.getState().pending, [id]: true } });
  try { return await fn(); } finally { active.delete(id); useLocks.getState().set({ pending: { ...useLocks.getState().pending, [id]: false } }); }
}
export async function register(device: BluetoothDevice, name: string, serial: string, key: string) {
  parseKey(key); if (!name.trim() || !serial.trim()) throw new Error('Enter a name and serial number.');
  if (device.name && device.name.startsWith('EL_') && device.name.slice(3).toLowerCase() !== serial.trim().toLowerCase()) throw new Error('Serial number does not match the selected device.');
  if ((await db.locks.where('bluetoothDeviceId').equals(device.id).count()) > 0) throw new Error('This device is already registered.');
  const id = crypto.randomUUID();
  const { lock, confirmedAt } = await exclusive(device.id, async () => {
    const outcome = await command(device, device.id, key, 1, true);
    if (outcome.result !== 'confirmed' || outcome.confirmedAt === undefined) throw new Error(outcome.detail ?? (outcome.result === 'rejected' ? 'The lock rejected the signing key or command.' : 'The test unlock could not be confirmed.'));
    const now = Date.now(); const lock: Lock = { id, bluetoothDeviceId: device.id, name: name.trim(), autoLock: true, model: 'Yeelock M02-compatible', serialNumber: serial.trim(), batteryLevel: outcome.battery, batteryUpdatedAt: outcome.battery === null ? null : now, lastConnectedAt: now, createdAt: now };
    await db.transaction('rw', db.locks, db.credentials, async () => { await db.locks.add(lock); await db.credentials.add({ lockId: id, signKey: key.trim() }); }); selected.set(id, device); await refresh(); return { lock, confirmedAt: outcome.confirmedAt };
  });
  scheduleAutoLock(lock, confirmedAt);
  return lock;
}
export async function rename(lock: Lock, name: string) {
  const value = name.trim();
  if (!value) throw new Error('Enter a lock name.');
  await db.locks.update(lock.id, { name: value });
  await refresh();
}
export async function setAutoLock(lock: Lock, enabled: boolean) {
  if (!enabled) { cancelAutoLock(lock.id); resultMessage(lock.id, 'Auto-lock disabled.'); }
  await db.locks.update(lock.id, { autoLock: enabled });
  await refresh();
}
function scheduleAutoLock(lock: Lock, confirmedAt: number) {
  if (document.visibilityState !== 'visible') {
    resultMessage(lock.id, 'Unlock confirmed. Auto-lock was cancelled because the app left the foreground. Lock the cabinet manually.');
    return;
  }
  setScheduled(lock.id, true);
  resultMessage(lock.id, 'Unlock confirmed. Auto-lock will start in 6 seconds.');
  autoLocks.schedule(lock.id, confirmedAt, () => {
    setScheduled(lock.id, false);
    if (document.visibilityState !== 'visible' || Date.now() > confirmedAt + 8000) { resultMessage(lock.id, 'Auto-lock was missed. Lock the cabinet manually.'); return; }
    void operate(lock, 2).catch(() => resultMessage(lock.id, 'Auto-lock could not start. Lock the cabinet manually.'));
  });
}
export async function operate(lock: Lock, action: 1 | 2) {
  if (active.has(lock.id)) throw new Error('An operation is already in progress.');
  const version = (operationVersions.get(lock.id) ?? 0) + 1;
  operationVersions.set(lock.id, version);
  cancelAutoLock(lock.id);
  const outcome = await exclusive(lock.id, async () => {
    const device = selected.get(lock.id) ?? await recoverDevice(lock.bluetoothDeviceId);
    if (!device) throw new Error('Bluetooth permission needs renewing. Tap Reconnect and select this lock.');
    selected.set(lock.id, device);
    const credential = await db.credentials.get(lock.id); if (!credential) throw new Error('Signing key is missing. Remove and add this lock again.');
    let outcome: Awaited<ReturnType<typeof command>>;
    try { outcome = await command(device, lock.id, credential.signKey, action, action === 1 && lock.autoLock); }
    catch (error) { if (error instanceof Error && error.name === 'SecurityError') selected.delete(lock.id); throw error; }
    const now = Date.now(); await db.locks.update(lock.id, { lastConnectedAt: now, ...(outcome.battery === null ? {} : { batteryLevel: outcome.battery, batteryUpdatedAt: now }) });
    await db.operations.add({ id: crypto.randomUUID(), lockId: lock.id, action: action === 1 ? 'unlock' : 'lock', status: outcome.result, timestamp: now });
    resultMessage(lock.id, outcome.detail ?? (outcome.result === 'confirmed' ? `${action === 1 ? 'Unlock' : 'Lock'} confirmed by the device.` : outcome.result === 'rejected' ? 'The device rejected the command.' : 'The result is unknown. Check the cabinet before trying again.'));
    await refresh(); return outcome;
  });
  const latest = await db.locks.get(lock.id);
  if (action === 1 && operationVersions.get(lock.id) === version && latest?.autoLock && outcome.result === 'confirmed' && outcome.confirmedAt !== undefined) {
    scheduleAutoLock(latest, outcome.confirmedAt);
  }
  return outcome;
}
export async function remove(lock: Lock) { if (active.has(lock.id)) throw new Error('Wait for the operation to finish.'); cancelAutoLock(lock.id); await db.removeLock(lock.id); selected.delete(lock.id); await refresh(); }
export async function inspect(lock: Lock) { return exclusive(lock.id, async () => { const device = selected.get(lock.id) ?? await recoverDevice(lock.bluetoothDeviceId); if (!device) throw new Error('Tap Reconnect first.'); const transport = new Transport(device, () => phase(lock.id, 'disconnected')); try { phase(lock.id, 'connecting'); await transport.connect(); phase(lock.id, 'connected'); return await transport.diagnostics(); } finally { transport.close(); phase(lock.id, 'disconnected'); } }); }
