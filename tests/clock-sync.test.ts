import { afterEach, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Transport } from '../src/bluetooth';
import { command } from '../src/service';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
afterEach(() => vi.restoreAllMocks());

it('sends a clock update on request without replaying the unlock', async () => {
  let notify: (value: DataView) => void = () => {};
  vi.spyOn(Transport.prototype, 'connect').mockResolvedValue();
  vi.spyOn(Transport.prototype, 'listen').mockImplementation(async handler => { notify = handler; return () => {}; });
  const write = vi.spyOn(Transport.prototype, 'write').mockImplementation(async () => {
    if (write.mock.calls.length === 1) notify(new DataView(Uint8Array.of(9).buffer));
  });
  vi.spyOn(Transport.prototype, 'close').mockImplementation(() => {});
  const device = { addEventListener() {} } as unknown as BluetoothDevice;
  const result = await command(device, 'lock', '00112233445566778899aabbccddeeff', 1);
  expect(result.result).toBe('unknown');
  expect(result.detail).toContain('check the cabinet');
  expect(write).toHaveBeenCalledTimes(2);
  expect(write.mock.calls.map(call => call[0][0])).toEqual([0x01, 0x08]);
});
