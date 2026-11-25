package com.camios.folio;

import android.content.Context;
import android.hardware.camera2.CameraAccessException;
import android.hardware.camera2.CameraCharacteristics;
import android.hardware.camera2.CameraManager;
import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "FolioTorch")
public class FolioTorchPlugin extends Plugin {
    private CameraManager cameraManager;
    private boolean enabledByFolio;
    private String torchCameraId;

    private final CameraManager.TorchCallback torchCallback = new CameraManager.TorchCallback() {
        @Override
        public void onTorchModeChanged(String cameraId, boolean enabled) {
            if (torchCameraId == null || !torchCameraId.equals(cameraId)) return;
            if (!enabled) enabledByFolio = false;
            JSObject event = new JSObject();
            event.put("enabled", enabled);
            notifyListeners("torchChanged", event, true);
        }

        @Override
        public void onTorchModeUnavailable(String cameraId) {
            if (torchCameraId == null || !torchCameraId.equals(cameraId)) return;
            enabledByFolio = false;
            JSObject event = new JSObject();
            event.put("enabled", false);
            notifyListeners("torchChanged", event, true);
        }
    };

    @Override
    public void load() {
        cameraManager = (CameraManager) getContext().getSystemService(Context.CAMERA_SERVICE);
        cameraManager.registerTorchCallback(torchCallback, new Handler(Looper.getMainLooper()));
    }

    private String rearFlashCameraId() throws CameraAccessException {
        if (cameraManager == null) return null;
        String fallback = null;
        for (String cameraId : cameraManager.getCameraIdList()) {
            CameraCharacteristics characteristics = cameraManager.getCameraCharacteristics(cameraId);
            Boolean hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE);
            if (!Boolean.TRUE.equals(hasFlash)) continue;
            if (fallback == null) fallback = cameraId;
            Integer facing = characteristics.get(CameraCharacteristics.LENS_FACING);
            if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) return cameraId;
        }
        return fallback;
    }

    private void disableTorch() {
        if (!enabledByFolio || cameraManager == null) return;
        try {
            String cameraId = rearFlashCameraId();
            if (cameraId != null) cameraManager.setTorchMode(cameraId, false);
        } catch (CameraAccessException | IllegalArgumentException | SecurityException ignored) {
            // Android también puede apagar el torch al pausar la actividad.
        } finally {
            enabledByFolio = false;
        }
    }

    @Override
    protected void handleOnPause() {
        disableTorch();
    }

    @Override
    protected void handleOnDestroy() {
        disableTorch();
        if (cameraManager != null) cameraManager.unregisterTorchCallback(torchCallback);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("available", rearFlashCameraId() != null);
            call.resolve(result);
        } catch (CameraAccessException | SecurityException error) {
            call.reject("No se pudo consultar el flash", error);
        }
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        if (!enabled && !enabledByFolio) {
            JSObject result = new JSObject();
            result.put("enabled", false);
            call.resolve(result);
            return;
        }
        try {
            String cameraId = rearFlashCameraId();
            if (cameraId == null) {
                call.reject("Este dispositivo no tiene flash trasero");
                return;
            }
            torchCameraId = cameraId;
            enabledByFolio = enabled;
            cameraManager.setTorchMode(cameraId, enabled);
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        } catch (CameraAccessException | IllegalArgumentException | SecurityException error) {
            enabledByFolio = false;
            call.reject(enabled ? "No se pudo activar el flash" : "No se pudo apagar el flash", error);
        }
    }
}
