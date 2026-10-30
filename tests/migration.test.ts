import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { db } from '../src/database';

it('keeps existing locks and credentials when adding the auto-lock setting', async () => {
  const old = new Dexie('yeelock-controller');
  old.version(1).stores({ locks: 'id, bluetoothDeviceId', credentials: 'lockId', operations: 'id, lockId, timestamp' });
  await old.table('locks').add({ id: 'old-lock', bluetoothDeviceId: 'bt', name: 'Cabinet' });
  await old.table('credentials').add({ lockId: 'old-lock', signKey: 'aabb' });
  old.close();
  expect(await db.locks.get('old-lock')).toMatchObject({ name: 'Cabinet', autoLock: false });
  expect(await db.credentials.get('old-lock')).toEqual({ lockId: 'old-lock', signKey: 'aabb' });
});
