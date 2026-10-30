import { describe, expect, it, vi } from 'vitest';
import { createHmac, webcrypto } from 'node:crypto';
import { notification, packet, parseKey, timePacket } from '../src/protocol';
import { bluetoothUnavailableMessage, deadline } from '../src/bluetooth';
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
describe('Yeelock M02 packet', () => {
  it('signs the 7-byte command with the first 13 HMAC-SHA1 bytes', async () => {
    const key = parseKey('00112233445566778899aabbccddeeff');
    const result = await packet(key, 1, 0x12345678);
    const header = Buffer.from('01501234567801', 'hex');
    expect(Buffer.from(result)).toEqual(Buffer.concat([header, createHmac('sha1', key).update(header).digest().subarray(0, 13)]));
  });
  it('signs a clock sync packet using the Yeelock 20-byte format', async () => {
    const key = parseKey('00112233445566778899aabbccddeeff');
    const header = Buffer.from('084012345678', 'hex');
    const result = await timePacket(key, 0x12345678);
    expect(Buffer.from(result)).toEqual(Buffer.concat([header, createHmac('sha1', key).update(header).digest().subarray(0, 14)]));
  });
  it('rejects invalid hexadecimal keys', () => { expect(() => parseKey('abc')).toThrow(); expect(() => parseKey('zz')).toThrow(); });
  it('recognizes completion, rejection and clock requests without accepting malformed responses', () => {
    const view = (...bytes: number[]) => new DataView(Uint8Array.from(bytes).buffer);
    expect(notification(view(3), 1)).toBe('confirmed'); expect(notification(view(3), 2)).toBeNull();
    expect(notification(view(0xff), 1)).toBe('rejected'); expect(notification(view(9), 1)).toBe('time');
    expect(notification(view(0x25), 1)).toBeNull(); expect(notification(view(), 1)).toBeNull();
  });
});
it('times out stalled operations', async () => { await expect(deadline(new Promise(() => {}), 5, 'Connection')).rejects.toThrow('Connection timed out'); });

it('explains Bluetooth availability for iPhone, insecure connections and unsupported browsers', () => {
  expect(bluetoothUnavailableMessage(true, 'Mozilla/5.0 (iPhone) CriOS')).toContain('iPhone');
  expect(bluetoothUnavailableMessage(false, 'Android')).toContain('HTTPS');
  expect(bluetoothUnavailableMessage(true, 'Android')).toContain('directly in Chrome');
});

it('filters Bluetooth discovery by Yeelock service or advertised name', async () => {
  const { chooseDevice } = await import('../src/bluetooth');
  const { SERVICE } = await import('../src/protocol');
  const requestDevice = vi.fn().mockResolvedValue({ id: 'device' });
  vi.stubGlobal('window', { isSecureContext: true });
  vi.stubGlobal('navigator', { bluetooth: { requestDevice }, userAgent: 'Android' });
  try {
    await chooseDevice();
    expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: [SERVICE] }, { namePrefix: 'EL_' }],
      optionalServices: [SERVICE, 'battery_service'],
    });
  } finally { vi.unstubAllGlobals(); }
});
