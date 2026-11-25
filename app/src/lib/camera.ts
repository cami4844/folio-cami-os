import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';

export async function requestCameraPermission(): Promise<void> {
  try {
    await Camera.requestPermissions({ permissions: ['camera'] });
  } catch {
    // El visor mostrará el estado real de getUserMedia.
  }
}

export async function captureNativePhoto(): Promise<Blob> {
  const photo = await Camera.getPhoto({
    quality: 94,
    resultType: CameraResultType.Uri,
    source: CameraSource.Camera,
    correctOrientation: true,
    allowEditing: false,
    presentationStyle: 'fullscreen',
  });
  if (!photo.webPath) throw new Error('La cámara no devolvió una imagen');
  const response = await fetch(Capacitor.convertFileSrc(photo.webPath));
  if (!response.ok) throw new Error('No se pudo leer la fotografía');
  return response.blob();
}

export const isNativeApp = () => Capacitor.isNativePlatform();
