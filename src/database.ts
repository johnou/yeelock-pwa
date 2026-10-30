import Dexie, { type Table } from 'dexie';
export interface Lock { id: string; bluetoothDeviceId: string; name: string; autoLock: boolean; model: string; serialNumber: string; batteryLevel: number | null; batteryUpdatedAt: number | null; lastConnectedAt: number | null; createdAt: number }
export interface Credential { lockId: string; signKey: string }
export interface Operation { id: string; lockId: string; action: string; status: string; timestamp: number }
class Database extends Dexie {
  locks!: Table<Lock, string>; credentials!: Table<Credential, string>; operations!: Table<Operation, string>;
  constructor() { super('yeelock-controller'); this.version(1).stores({ locks: 'id, bluetoothDeviceId', credentials: 'lockId', operations: 'id, lockId, timestamp' }); this.version(2).stores({ locks: 'id, bluetoothDeviceId', credentials: 'lockId', operations: 'id, lockId, timestamp' }).upgrade(tx => tx.table('locks').toCollection().modify({ autoLock: false })); }
  async removeLock(id: string) { await this.transaction('rw', this.locks, this.credentials, this.operations, async () => { await this.locks.delete(id); await this.credentials.delete(id); await this.operations.where('lockId').equals(id).delete(); }); }
}
export const db = new Database();
