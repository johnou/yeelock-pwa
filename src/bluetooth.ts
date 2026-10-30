import { COMMAND, NOTIFY, SERVICE } from './protocol';
export const TIMEOUT = { connect: 10000, response: 5000, battery: 3000 };
export function deadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(`${label} timed out.`)), ms); promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); }); });
}
export class Transport {
  private server: BluetoothRemoteGATTServer | null = null;
  private command: BluetoothRemoteGATTCharacteristic | null = null;
  private notify: BluetoothRemoteGATTCharacteristic | null = null;
  constructor(readonly device: BluetoothDevice, private disconnected: () => void) { device.addEventListener('gattserverdisconnected', this.disconnected); }
  async connect() {
    if (!this.device.gatt) throw new Error('GATT is unavailable on this device.');
    const pending = this.device.gatt.connect();
    try { this.server = await deadline(pending, TIMEOUT.connect, 'Connection'); }
    catch (error) { void pending.then(server => server.disconnect(), () => {}); throw error; }
    const service = await deadline(this.server.getPrimaryService(SERVICE), TIMEOUT.connect, 'Service discovery');
    this.command = await deadline(service.getCharacteristic(COMMAND), TIMEOUT.connect, 'Characteristic discovery');
    this.notify = await deadline(service.getCharacteristic(NOTIFY), TIMEOUT.connect, 'Characteristic discovery');
    if ((!this.command.properties.write && !this.command.properties.writeWithoutResponse) || !this.notify.properties.notify) throw new Error('This device does not expose the supported Yeelock characteristics.');
  }
  async listen(handler: (data: DataView) => void) {
    const characteristic = this.notify;
    if (!characteristic) throw new Error('Device is not connected.');
    const listener = () => { if (characteristic.value) handler(characteristic.value); };
    characteristic.addEventListener('characteristicvaluechanged', listener);
    try { await deadline(characteristic.startNotifications(), TIMEOUT.response, 'Notifications'); }
    catch (error) { characteristic.removeEventListener('characteristicvaluechanged', listener); throw error; }
    return () => { characteristic.removeEventListener('characteristicvaluechanged', listener); if (this.device.gatt?.connected) void characteristic.stopNotifications().catch(() => {}); };
  }
  async write(data: Uint8Array<ArrayBuffer>) {
    const c = this.command; if (!c) throw new Error('Device is not connected.');
    if (c.properties.write) await c.writeValueWithResponse(data); else await c.writeValueWithoutResponse(data);
  }
  async battery(): Promise<number | null> {
    try { if (!this.server) return null; const service = await deadline(this.server.getPrimaryService('battery_service'), TIMEOUT.battery, 'Battery service'); const c = await deadline(service.getCharacteristic('battery_level'), TIMEOUT.battery, 'Battery characteristic'); const value = await deadline(c.readValue(), TIMEOUT.battery, 'Battery read'); const n = value.getUint8(0); return n <= 100 ? n : null; } catch { return null; }
  }
  async diagnostics() {
    if (!this.server) throw new Error('Device is not connected.');
    const services = await this.server.getPrimaryServices();
    return Promise.all(services.map(async s => ({ uuid: s.uuid, characteristics: (await s.getCharacteristics()).map(c => ({ uuid: c.uuid, read: c.properties.read, write: c.properties.write, writeWithoutResponse: c.properties.writeWithoutResponse, notify: c.properties.notify, indicate: c.properties.indicate })) })));
  }
  close() { this.device.removeEventListener('gattserverdisconnected', this.disconnected); if (this.device.gatt?.connected) this.device.gatt.disconnect(); this.server = null; }
}
export function bluetoothUnavailableMessage(secure: boolean, userAgent: string): string {
  if (!secure) return 'Bluetooth requires a secure connection. Open this app over HTTPS.';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'Bluetooth control is not available in Chrome on iPhone or iPad. Open this app in Chrome on an Android device to connect to your lock.';
  return 'This browser does not expose Web Bluetooth. Open the app directly in Chrome on Android over HTTPS; in-app browsers may not support it.';
}
export function bluetoothSupportMessage(): string | null {
  return navigator.bluetooth ? null : bluetoothUnavailableMessage(window.isSecureContext, navigator.userAgent);
}
export async function chooseDevice(): Promise<BluetoothDevice> {
  const unavailable = bluetoothSupportMessage();
  if (unavailable) throw new Error(unavailable);
  return navigator.bluetooth.requestDevice({ filters: [{ services: [SERVICE] }, { namePrefix: 'EL_' }], optionalServices: [SERVICE, 'battery_service'] });
}
export async function recoverDevice(id: string): Promise<BluetoothDevice | null> {
  if (!navigator.bluetooth?.getDevices) return null;
  return (await navigator.bluetooth.getDevices()).find(device => device.id === id) ?? null;
}
