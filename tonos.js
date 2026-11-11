/* ---------- TONOS (micrófono INMP441 del robot) ----------
   El que escucha es el micrófono conectado a la ESP32: la FFT y la decisión
   ocurren en el robot. Esta página solo:
     1) le manda "tonos" para activar el control por tonos, y
     2) muestra lo que el robot detecta (avisos por notificación Bluetooth).
   Tonos: 650 Hz adelante · 950 Hz atrás · 1250 Hz izquierda · 1550 Hz derecha.
   Sin tono, el robot se detiene solo ("hombre muerto"). */
let toneActive = false;
let toneNotifyOn = false;

const toneBtn = document.getElementById("toneBtn");
const toneStateEl = document.getElementById("toneState");
const toneHistoryEl = document.getElementById("toneHistory");

function onRobotMessage(event) {
  const text = new TextDecoder().decode(event.target.value);
  if (!toneActive || /^(ad|at|ga|gh) |^stop$|^tonos/.test(text)) return;  // ignora ecos de comandos
  toneStateEl.textContent = text;
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  toneHistoryEl.prepend(item);
  while (toneHistoryEl.children.length > 8) toneHistoryEl.lastChild.remove();
}

async function startTones() {
  if (!characteristic) { setLog("Primero conecta el robot."); return; }
  try {
    if (!toneNotifyOn) {
      characteristic.addEventListener("characteristicvaluechanged", onRobotMessage);
      await characteristic.startNotifications();
      toneNotifyOn = true;
    }
    toneActive = true;
    await sendCommand("tonos", true);
    toneBtn.textContent = "✓ Robot escuchando — tocar para detener";
    toneBtn.classList.add("active-camera");
    toneStateEl.textContent = "REPOSO esperando tono";
    setLog("Modo tonos activo: el micrófono del robot está escuchando.");
  } catch (error) {
    console.error(error);
    toneActive = false;
    setLog(`No se pudo activar el modo tonos: ${error.message}`);
  }
}

function stopTones(sendStop = true) {
  toneActive = false;
  toneBtn.textContent = "🎵 Activar control por tonos";
  toneBtn.classList.remove("active-camera");
  toneStateEl.textContent = "—";
  if (sendStop) sendCommand("stop", true);   // "stop" saca al robot del modo tonos
  setLog("Control por tonos detenido.");
}

toneBtn.addEventListener("click", () => (toneActive ? stopTones() : startTones()));
