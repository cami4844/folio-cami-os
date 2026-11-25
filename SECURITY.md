# Seguridad y privacidad

## Datos locales

Folio guarda documentos en IndexedDB. Android Backup está desactivado. No hay cuentas, analítica ni sincronización por defecto. La traducción es opcional y debe informar antes de usar internet.

## Secretos de build

No publiques claves, contraseñas, keystores, `keystore.properties`, `local.properties`, `google-services.json`, `.env`, documentos personales o capturas privadas. Usa variables de entorno o archivos locales ignorados.

## Electron

El proceso principal conserva `contextIsolation`, `sandbox`, `nodeIntegration: false`, navegación externa bloqueada y validación de remitente/formato/tamaño al guardar.

## Reportar un problema

Abre un issue sin adjuntar documentos privados, credenciales ni datos personales. Incluye versión, plataforma, pasos y resultado esperado. No envíes tokens ni contraseñas por GitHub.

## Actualizaciones y firma

La llave de release Android no se distribuye. Cada persona que compile una release debe usar su propia identidad de firma o configurar una llave local protegida. Conserva copias cifradas de tus claves fuera del repositorio.
