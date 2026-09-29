import * as os from 'os';
import * as crypto from 'crypto';

let cachedDeviceId: string | null = null;

/**
 * Makinenin ilk dahili olmayan (non-internal) MAC adresini alır
 * ve SHA-256 ile özetleyerek anonim bir cihaz kimliği üretir.
 * Saf (raw) MAC adresi bellekte veya dış dünyada asla saklanmaz.
 */
export function getAnonymizedDeviceId(): string {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const interfaces = os.networkInterfaces();
    let selectedMac: string | null = null;

    for (const name of Object.keys(interfaces)) {
      const ifaceList = interfaces[name];
      if (!ifaceList) continue;
      for (const iface of ifaceList) {
        if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
          selectedMac = iface.mac;
          break;
        }
      }
      if (selectedMac) break;
    }

    const rawInput = selectedMac || os.hostname() || 'lupin-default-device';
    cachedDeviceId = crypto.createHash('sha256').update(rawInput).digest('hex');
  } catch {
    cachedDeviceId = crypto.createHash('sha256').update(os.hostname() || 'lupin-fallback').digest('hex');
  }

  return cachedDeviceId;
}
