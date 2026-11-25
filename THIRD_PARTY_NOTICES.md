# Avisos de terceros

Folio es una implementación propia. Las referencias a técnicas no implican copia de código de esos proyectos.

## Dependencias principales

- OpenCV.js (`@techstark/opencv-js`) — Apache-2.0.
- Tesseract.js y datos OCR (`@tesseract.js-data/eng`, `@tesseract.js-data/spa`) — Apache-2.0 / MIT según paquete.
- pdf-lib — MIT.
- pdfjs-dist — Apache-2.0.
- Capacitor y plugins oficiales — MIT.
- Electron — MIT.
- React y React DOM — MIT.
- Vite — MIT.
- TypeScript — Apache-2.0.
- Lucide React — ISC.
- idb — ISC.
- Fraunces y Manrope variables — SIL Open Font License 1.1.
- Sharp — Apache-2.0.

Los textos completos de las licencias se conservan en los paquetes npm correspondientes. Esta lista no cambia las licencias de esos proyectos.

## Técnicas y documentación consultadas

- OpenCV: Canny, contornos, `approxPolyDP`, `HoughLinesP`, `getPerspectiveTransform` y `warpPerspective`.
- jscanify (MIT): detección en navegador y puntos extremos, reimplementados por Folio.
- WeScan (MIT): estabilidad temporal de rectángulos, reimplementada por Folio.
- Leptonica (BSD-2-Clause): mapa reducido de iluminación y normalización por fondo.
- Doxa (CC0): referencia de Sauvola e imágenes integrales para binarización.
- Swiper (MIT): referencia de interacción por deslizamiento; Folio usa gestos propios sin esa dependencia.
- Capacitor Torch/Camera APIs (MIT): referencia de control nativo de flash.

No se copiaron árboles, modelos, datasets ni código de FairScan, OpenNoteScanner, ScanTailor u otros proyectos GPL/AGPL. Las instantáneas locales de investigación no forman parte de este repositorio.
