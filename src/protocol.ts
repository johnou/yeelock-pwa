// Based on Yeehack's packet.py (Apache-2.0): https://github.com/aso824/yeehack
export const SERVICE = '58af3dca-6fc0-4fa3-9464-74662f043a39';
export const COMMAND = '58af3dca-6fc0-4fa3-9464-74662f043a3b';
export const NOTIFY = '58af3dca-6fc0-4fa3-9464-74662f043a3a';
export type Result = 'confirmed' | 'rejected' | 'unknown';
export function parseKey(hex: string): Uint8Array {
  const value = hex.trim();
  if (!/^(?:[0-9a-fA-F]{2})+$/.test(value)) throw new Error('Enter the signing key as an even number of hexadecimal characters.');
  return Uint8Array.from(value.match(/../g) ?? [], byte => parseInt(byte, 16));
}
export async function packet(key: Uint8Array, mode: 1 | 2, timestamp = Math.floor(Date.now() / 1000)): Promise<Uint8Array<ArrayBuffer>> {
  const payload = new Uint8Array(7);
  payload[0] = 1; payload[1] = 0x50;
  new DataView(payload.buffer).setUint32(2, timestamp, false);
  payload[6] = mode;
  const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, payload));
  const output = new Uint8Array(20); output.set(payload); output.set(signature.subarray(0, 13), 7); return output;
}
export async function timePacket(key: Uint8Array, timestamp = Math.floor(Date.now() / 1000)): Promise<Uint8Array<ArrayBuffer>> {
  const payload = new Uint8Array(6);
  payload[0] = 0x08; payload[1] = 0x40;
  new DataView(payload.buffer).setUint32(2, timestamp, false);
  const cryptoKey = await crypto.subtle.importKey('raw', new Uint8Array(key), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, payload));
  const output = new Uint8Array(20); output.set(payload); output.set(signature.subarray(0, 14), 6); return output;
}
export function notification(data: DataView, mode: 1 | 2): Result | 'time' | null {
  if (!data.byteLength) return null;
  const code = data.getUint8(0);
  if (code === 0xff || (code === 0x25 && data.byteLength > 1 && data.getUint8(1) === 0x40)) return 'rejected';
  if (code === 0x09) return 'time';
  if ((mode === 1 && code === 3) || (mode === 2 && code === 5)) return 'confirmed';
  return null;
}
