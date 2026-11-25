import { Capacitor, registerPlugin } from '@capacitor/core';

interface FolioTorchPlugin {
  isAvailable(): Promise<{ available: boolean }>;
  setEnabled(options: { enabled: boolean }): Promise<{ enabled: boolean }>;
  addListener(eventName: 'torchChanged', listener: (event: { enabled: boolean }) => void): Promise<{ remove: () => void }>;
}

const torchPlugin = registerPlugin<FolioTorchPlugin>('FolioTorch');
let ownedByFolio = false;
let operation: Promise<boolean> = Promise.resolve(false);

export async function nativeTorchAvailable(): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return false;
  try {
    return (await torchPlugin.isAvailable()).available;
  } catch {
    return false;
  }
}

export function setNativeTorch(enabled: boolean): Promise<boolean> {
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve(false);
  operation = operation.catch(() => false).then(async () => {
    if (!enabled && !ownedByFolio) return true;
    try {
      const result = await torchPlugin.setEnabled({ enabled });
      if (enabled && result.enabled) {
        ownedByFolio = true;
        return true;
      }
      if (!enabled) {
        ownedByFolio = false;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  });
  return operation;
}

export async function onNativeTorchChanged(listener: (enabled: boolean) => void): Promise<() => void> {
  if (Capacitor.getPlatform() !== 'android') return () => undefined;
  const subscription = await torchPlugin.addListener('torchChanged', (event) => {
    if (!event.enabled) ownedByFolio = false;
    listener(event.enabled);
  });
  return () => { void subscription.remove(); };
}
