# Robot-IA — Web Bluetooth

Página web responsive para controlar el ESP32-C3 del proyecto LAB02_SEMANA2_WEB_BLUETOOTH.

## Bluetooth configurado

- Nombre: Robot-IA
- Service UUID: 4fafc201-1fb5-459e-8fcc-c5c9c331914b
- Characteristic UUID: beb5483e-36e1-4688-b7f5-ea07361b26a8

## Comandos usados

- `ad 150` — adelante
- `at 150` — atrás
- `ga 150` — izquierda
- `gh 150` — derecha
- `stop` — detener

La página permite cambiar la velocidad entre 0 y 255.

## Publicar con GitHub Pages

1. Crea un repositorio nuevo en GitHub, por ejemplo `robot-ia-web`.
2. Sube `index.html`, `style.css` y `app.js` a la raíz del repositorio.
3. En GitHub entra a Settings → Pages.
4. En Build and deployment selecciona:
   - Source: Deploy from a branch
   - Branch: `main`
   - Folder: `/ (root)`
5. Guarda y espera a que GitHub Pages publique el sitio.
6. Abre la URL HTTPS desde Chrome en Android.

## Importante

Web Bluetooth necesita un contexto seguro (HTTPS) y un navegador/dispositivo compatible. Para las pruebas de este proyecto, usa Chrome en Android.

No necesitas subir la carpeta `.pio` ni el código del ESP32 al repositorio de la página. El ESP32 sigue usando su firmware actual.


## Modos adicionales

- 🎤 Voz: Web Speech API (Chrome/Android cuando esté disponible).
- ✋ Gestos: MediaPipe Hands + cámara.
- 🙂 Cara: MediaPipe Face Mesh + cámara.
- 📱 Movimiento: el mismo sensor de orientación, ahora con botón para activarlo/desactivarlo.

Las cámaras no se suben a un servidor por este código: el procesamiento se hace en el navegador. Los modelos de MediaPipe se cargan desde jsDelivr.
