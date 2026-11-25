# Folio

Escáner documental local para Android y Windows, construido con React, TypeScript, OpenCV.js, Capacitor y Electron. **Powered by Cami-OS.**

Folio detecta hojas, endereza perspectiva, limpia iluminación, organiza páginas, reconoce texto localmente y exporta PDF, JPG, TXT, Word y Excel. No requiere cuentas ni anuncios.

## Funciones

- Cámara con detección y autocaptura estable, zoom coherente y torch nativo Android.
- Edición manual de cuatro puntos por toda la foto, lupa y validación geométrica.
- Filtros Original, Mágico, Grises y B/N con procesamiento local.
- Lector con miniaturas, zoom, pantalla completa y páginas deslizables.
- Editor con recorte, giro, filtros, reorden, duplicado y borrado.
- OCR local en español e inglés, búsqueda y edición del texto.
- PDF real con opciones y vista previa, Word, Excel, TXT y JPG.
- Biblioteca local con favoritos, combinación, duplicado y documentos multipágina.
- Sin nube por defecto. La traducción es opcional y es la única función con internet.

## Requisitos

- Node.js 22.12 o superior y npm.
- JDK 21 para Android.
- Android SDK 36 y build-tools 36.1.0 para Android.
- Windows para generar los instaladores NSIS y portable de Electron.

## Desarrollo

```bash
cd app
npm ci
npm run dev
```

Compilación web y comprobación de TypeScript:

```bash
npm run build
```

Electron en desarrollo:

```bash
npm run electron:dev
```

Generar instalador y portable Windows:

```bash
npm run electron:build
```

## Android

Configura `ANDROID_HOME` o `ANDROID_SDK_ROOT` y `JAVA_HOME`.

```bash
cd app
npm run android:sync
cd android
./gradlew.bat assembleDebug
```

En sistemas no Windows usa `./gradlew` en lugar de `./gradlew.bat`.

### Firma de release

No incluyas keystores ni contraseñas en el repositorio. Usa variables de entorno o copia `app/android/keystore.properties.example` como `app/android/keystore.properties` y rellena tus valores locales.

Variables admitidas:

```text
FOLIO_ANDROID_KEYSTORE=/ruta/local/a/tu-keystore.jks
FOLIO_ANDROID_STORE_PASSWORD=...
FOLIO_ANDROID_KEY_ALIAS=...
FOLIO_ANDROID_KEY_PASSWORD=...
```

`app/android/keystore.properties` está ignorado por Git. El keystore también debe permanecer fuera del repositorio.

Generar release:

```bash
cd app/android
./gradlew.bat assembleRelease --no-daemon
```

El build falla si la configuración de firma está incompleta; no genera una release pública sin identidad válida.

## Privacidad

Los documentos se guardan localmente. Android Backup está desactivado. Electron usa `contextIsolation`, `sandbox` y `nodeIntegration: false`. La app no contiene telemetría.

**Nunca publiques documentos, capturas, keystores, credenciales, `local.properties`, `google-services.json` ni archivos `.env`.**

## Estructura

- `app/src`: interfaz y motor documental.
- `app/electron`: proceso principal y puente seguro de Electron.
- `app/android`: proyecto Capacitor/Android y wrapper de Gradle.
- `app/public`: recursos locales de la app y OCR.
- `app/tests`: utilidades de build y pruebas para quien mantenga el proyecto.

## Licencia

Código bajo [MIT](LICENSE). La marca Cami-OS no se licencia para sugerir respaldo o afiliación oficial. Consulta [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) para dependencias y técnicas consultadas.
