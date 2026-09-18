const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";
const BLE_DEVICE_NAME = "Robot-IA";

let device = null;
let characteristic = null;
let sensorActive = false;
let lastCommand = "stop";
let lastSentAt = 0;
let currentSpeed = 150;
let currentMode = "buttons";

let recognition = null;
let voiceActive = false;

let handsCamera = null;
let faceCamera = null;
let handsActive = false;
let faceActive = false;

const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const statusEl = document.getElementById("status");
const statusDot = document.getElementById("statusDot");
const deviceNameEl = document.getElementById("deviceName");
const logEl = document.getElementById("log");
const lastCommandEl = document.getElementById("lastCommand");
const speedEl = document.getElementById("speed");
const speedValueEl = document.getElementById("speedValue");
const betaEl = document.getElementById("beta");
const gammaEl = document.getElementById("gamma");
const sensorCommandEl = document.getElementById("sensorCommand");
const sensorBtn = document.getElementById("sensorBtn");
const emergencyBtn = document.getElementById("emergencyBtn");

function setStatus(text, state = "disconnected") {
  statusEl.textContent = text;
  statusDot.className = "status-dot";
  if (state === "connected") statusDot.classList.add("connected");
  if (state === "error") statusDot.classList.add("error");
}

function setLog(message) { logEl.textContent = message; }

function commandWithSpeed(action) {
  return action === "stop" ? "stop" : `${action} ${currentSpeed}`;
}

function markCommand(command) {
  lastCommand = command;
  lastCommandEl.textContent = command;
}

async function connectRobot() {
  if (!navigator.bluetooth) {
    setStatus("Bluetooth no disponible", "error");
    setLog("Usa Chrome en Android y abre esta página mediante HTTPS.");
    return;
  }
  try {
    connectBtn.disabled = true;
    setLog("Buscando Robot-IA...");
    setStatus("Buscando...");
    device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID]
    });
    device.addEventListener("gattserverdisconnected", handleDisconnected);
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
    setStatus("Conectado", "connected");
    deviceNameEl.textContent = device.name || BLE_DEVICE_NAME;
    connectBtn.classList.add("hidden");
    disconnectBtn.classList.remove("hidden");
    setLog("Robot conectado. ¡Listo!");
  } catch (error) {
    console.error(error);
    characteristic = null;
    setStatus("Desconectado", "error");
    setLog(formatBluetoothError(error));
  } finally { connectBtn.disabled = false; }
}

function handleDisconnected() {
  characteristic = null;
  setStatus("Desconectado");
  deviceNameEl.textContent = "Sin robot";
  connectBtn.classList.remove("hidden");
  disconnectBtn.classList.add("hidden");
  setLog("Robot desconectado.");
}

function formatBluetoothError(error) {
  if (error?.name === "NotFoundError") return "No seleccionaste un dispositivo o cancelaste Bluetooth.";
  return `No se pudo conectar: ${error?.message || error}`;
}

async function disconnectRobot() {
  try {
    await sendCommand("stop", true);
    if (device?.gatt?.connected) device.gatt.disconnect();
  } catch (error) { console.error(error); handleDisconnected(); }
}

async function sendCommand(command, silent = false) {
  if (!characteristic) {
    if (!silent) setLog("Primero conecta el robot.");
    return false;
  }
  try {
    const data = new TextEncoder().encode(command);
    if (typeof characteristic.writeValueWithResponse === "function") {
      await characteristic.writeValueWithResponse(data);
    } else {
      await characteristic.writeValue(data);
    }
    markCommand(command);
    if (!silent) setLog(`Enviado: ${command}`);
    return true;
  } catch (error) {
    console.error(error);
    setLog(`Error enviando "${command}": ${error.message}`);
    return false;
  }
}

document.querySelectorAll("[data-command]").forEach(button => {
  button.addEventListener("click", () => {
    const action = button.dataset.command.split(" ")[0];
    sendCommand(commandWithSpeed(action));
  });
});

connectBtn.addEventListener("click", connectRobot);
disconnectBtn.addEventListener("click", disconnectRobot);

const modeSections = {
  buttons: "buttonsMode",
  accelerometer: "accelerometerMode",
  voice: "voiceMode",
  hands: "handsMode",
  face: "faceMode"
};

document.querySelectorAll(".mode").forEach(button => {
  button.addEventListener("click", async () => {
    currentMode = button.dataset.mode;
    document.querySelectorAll(".mode").forEach(b => b.classList.remove("active"));
    button.classList.add("active");

    Object.entries(modeSections).forEach(([mode, id]) => {
      document.getElementById(id).classList.toggle("hidden", mode !== currentMode);
    });

    stopAllSensorsExcept(currentMode);

    if (currentMode === "voice") setupVoice();
    if (currentMode === "hands") setLog("Pulsa “Activar cámara” para comenzar.");
    if (currentMode === "face") setLog("Pulsa “Activar cámara facial” para comenzar.");
    if (characteristic && currentMode !== "accelerometer") await sendCommand("stop", true);
  });
});

speedEl.addEventListener("input", () => {
  currentSpeed = Number(speedEl.value);
  speedValueEl.textContent = currentSpeed;
});

emergencyBtn.addEventListener("click", () => sendCommand("stop"));

function commandFromOrientation(beta, gamma) {
  const threshold = 15;
  if (beta > threshold) return commandWithSpeed("ad");
  if (beta < -threshold) return commandWithSpeed("at");
  if (gamma > threshold) return commandWithSpeed("gh");
  if (gamma < -threshold) return commandWithSpeed("ga");
  return "stop";
}

async function handleOrientation(event) {
  if (currentMode !== "accelerometer") return;
  const beta = Number(event.beta || 0);
  const gamma = Number(event.gamma || 0);
  betaEl.textContent = beta.toFixed(1);
  gammaEl.textContent = gamma.toFixed(1);
  const command = commandFromOrientation(beta, gamma);
  sensorCommandEl.textContent = command;
  const now = Date.now();
  if (command !== lastCommand || now - lastSentAt > 500) {
    lastSentAt = now;
    await sendCommand(command, true);
  }
}

async function activateSensor() {
  try {
    if (typeof DeviceOrientationEvent === "undefined") {
      setLog("Este dispositivo no tiene sensor de orientación.");
      return;
    }
    if (typeof DeviceOrientationEvent.requestPermission === "function") {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") { setLog("Permiso de movimiento denegado."); return; }
    }
    if (!sensorActive) {
      window.addEventListener("deviceorientation", handleOrientation, true);
      sensorActive = true;
      sensorBtn.textContent = "✓ Sensor activado — tocar para desactivar";
      sensorBtn.classList.add("active-camera");
      setLog("Sensor activo. Inclina el celular suavemente.");
    } else {
      deactivateSensor();
    }
  } catch (error) {
    console.error(error);
    setLog(`No se pudo activar el sensor: ${error.message}`);
  }
}

function deactivateSensor() {
  window.removeEventListener("deviceorientation", handleOrientation, true);
  sensorActive = false;
  sensorBtn.textContent = "📱 Activar sensor";
  sensorBtn.classList.remove("active-camera");
  betaEl.textContent = "0.0";
  gammaEl.textContent = "0.0";
  sensorCommandEl.textContent = "stop";
  sendCommand("stop", true);
  setLog("Control por movimiento desactivado.");
}

sensorBtn.addEventListener("click", activateSensor);

/* ---------- VOZ ---------- */
const voiceBtn = document.getElementById("voiceBtn");
const voiceText = document.getElementById("voiceText");
const voiceSupport = document.getElementById("voiceSupport");

function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    voiceSupport.textContent = "El navegador no ofrece reconocimiento de voz. Prueba Chrome en Android.";
    voiceBtn.disabled = true;
    return;
  }
  if (recognition) return;
  recognition = new SpeechRecognition();
  recognition.lang = "es-CO";
  recognition.continuous = true;
  recognition.interimResults = false;

  recognition.onstart = () => {
    voiceActive = true;
    voiceBtn.textContent = "🛑 Detener voz";
    voiceBtn.classList.add("listening");
    voiceSupport.textContent = "Escuchando comandos en español...";
  };
  recognition.onend = () => {
    voiceActive = false;
    voiceBtn.textContent = "🎤 Activar voz";
    voiceBtn.classList.remove("listening");
  };
  recognition.onerror = e => {
    voiceActive = false;
    voiceBtn.textContent = "🎤 Activar voz";
    voiceSupport.textContent = `Voz: ${e.error}`;
  };
  recognition.onresult = event => {
    const text = event.results[event.results.length - 1][0].transcript.toLowerCase().trim();
    voiceText.textContent = text;
    const command = voiceToCommand(text);
    if (command) sendCommand(command);
  };
}

function voiceToCommand(text) {
  if (/stop|para|parar|detente|detener|alto/.test(text)) return "stop";
  if (/adelante|avanza|avanzar/.test(text)) return commandWithSpeed("ad");
  if (/atrás|atras|retrocede|retroceder/.test(text)) return commandWithSpeed("at");
  if (/izquierda|gira a la izquierda/.test(text)) return commandWithSpeed("ga");
  if (/derecha|gira a la derecha/.test(text)) return commandWithSpeed("gh");
  return null;
}

voiceBtn.addEventListener("click", () => {
  setupVoice();
  if (!recognition) return;
  if (voiceActive) recognition.stop();
  else {
    try { recognition.start(); }
    catch (e) { console.error(e); }
  }
});

/* ---------- GESTOS DE MANO ---------- */
const handsBtn = document.getElementById("handsBtn");
const handsVideo = document.getElementById("handsVideo");
const handsCanvas = document.getElementById("handsCanvas");
const handsCtx = handsCanvas.getContext("2d");
const handGesture = document.getElementById("handGesture");
const handsStatus = document.getElementById("handsStatus");

function fingersUp(lm) {
  const tips = [8, 12, 16, 20], pips = [6, 10, 14, 18];
  return tips.map((tip, i) => lm[tip].y < lm[pips[i]].y);
}

function detectHandGesture(lm) {
  const up = fingersUp(lm);
  const thumbUp = lm[4].y < lm[3].y;
  const thumbDown = lm[4].y > lm[3].y;
  const indexOnly = up[0] && !up[1] && !up[2] && !up[3];
  const open = up.every(Boolean);
  const fist = !up.some(Boolean);

  if (open) return ["✋ STOP", "stop"];
  if (thumbUp && !up[1] && !up[2] && !up[3]) return ["👍 ADELANTE", commandWithSpeed("ad")];
  if (thumbDown && fist) return ["👇 ATRÁS", commandWithSpeed("at")];
  if (indexOnly) {
    const dx = lm[8].x - lm[5].x;
    return dx < 0 ? ["☝️ IZQUIERDA", commandWithSpeed("ga")] : ["☝️ DERECHA", commandWithSpeed("gh")];
  }
  return ["—", null];
}

async function startHands() {
  if (handsActive) { stopHands(); return; }
  if (typeof Hands === "undefined" || typeof Camera === "undefined") {
    handsStatus.textContent = "No se cargó el detector de manos. Recarga la página.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    handsVideo.srcObject = stream;
    const hands = new Hands({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}` });
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: .65, minTrackingConfidence: .6 });
    hands.onResults(results => {
      if (!handsActive) return;
      handsCanvas.width = handsVideo.videoWidth || 640;
      handsCanvas.height = handsVideo.videoHeight || 480;
      handsCtx.clearRect(0, 0, handsCanvas.width, handsCanvas.height);
      if (results.multiHandLandmarks?.length) {
        const lm = results.multiHandLandmarks[0];
        drawConnectors(handsCtx, lm, HAND_CONNECTIONS);
        drawLandmarks(handsCtx, lm);
        const [label, command] = detectHandGesture(lm);
        handGesture.textContent = label;
        if (command) sendVisionCommand(command);
      } else handGesture.textContent = "No detectado";
    });
    handsCamera = new Camera(handsVideo, {
      onFrame: async () => await hands.send({ image: handsVideo }),
      width: 640, height: 480
    });
    handsActive = true;
    handsBtn.textContent = "🛑 Desactivar cámara";
    handsBtn.classList.add("active-camera");
    handsStatus.textContent = "Cámara activa. Haz un gesto frente al celular.";
    handsCamera.start();
  } catch (e) {
    console.error(e);
    handsStatus.textContent = `Permiso de cámara requerido: ${e.message}`;
  }
}

function stopHands() {
  handsActive = false;
  if (handsCamera) { try { handsCamera.stop(); } catch (_) {} handsCamera = null; }
  stopVideo(handsVideo);
  handsCtx.clearRect(0, 0, handsCanvas.width, handsCanvas.height);
  handsBtn.textContent = "📷 Activar cámara";
  handsBtn.classList.remove("active-camera");
  handGesture.textContent = "—";
  sendCommand("stop", true);
  handsStatus.textContent = "Cámara desactivada.";
}

handsBtn.addEventListener("click", startHands);

/* ---------- CARA ---------- */
const faceBtn = document.getElementById("faceBtn");
const faceVideo = document.getElementById("faceVideo");
const faceCanvas = document.getElementById("faceCanvas");
const faceCtx = faceCanvas.getContext("2d");
const faceGesture = document.getElementById("faceGesture");
const faceStatus = document.getElementById("faceStatus");

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

function detectFaceGesture(lm) {
  // Índices estándar de MediaPipe Face Mesh.
  const leftEyeTop = lm[159], leftEyeBottom = lm[145];
  const rightEyeTop = lm[386], rightEyeBottom = lm[374];
  const leftEyeL = lm[33], leftEyeR = lm[133];
  const rightEyeL = lm[362], rightEyeR = lm[263];
  const mouthTop = lm[13], mouthBottom = lm[14];
  const mouthL = lm[61], mouthR = lm[291];
  const browL = lm[70], browLRef = lm[105];
  const browR = lm[300], browRRef = lm[334];

  const leftRatio = dist(leftEyeTop, leftEyeBottom) / Math.max(dist(leftEyeL, leftEyeR), .001);
  const rightRatio = dist(rightEyeTop, rightEyeBottom) / Math.max(dist(rightEyeL, rightEyeR), .001);
  const mouthRatio = dist(mouthTop, mouthBottom) / Math.max(dist(mouthL, mouthR), .001);
  const browLift = ((browL.y - browLRef.y) + (browR.y - browRRef.y)) / 2;

  if (mouthRatio > .28) return ["😮 STOP", "stop"];
  if (leftRatio < .12 && rightRatio > .20) return ["😉 DERECHA", commandWithSpeed("gh")];
  if (rightRatio < .12 && leftRatio > .20) return ["😉 IZQUIERDA", commandWithSpeed("ga")];
  if (browLift < -.015) return ["😯 ADELANTE", commandWithSpeed("ad")];
  return ["—", null];
}

async function startFace() {
  if (faceActive) { stopFace(); return; }
  if (typeof FaceMesh === "undefined" || typeof Camera === "undefined") {
    faceStatus.textContent = "No se cargó el detector facial. Recarga la página.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
    faceVideo.srcObject = stream;
    const mesh = new FaceMesh({ locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
    mesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: .65, minTrackingConfidence: .6 });
    mesh.onResults(results => {
      if (!faceActive) return;
      faceCanvas.width = faceVideo.videoWidth || 640;
      faceCanvas.height = faceVideo.videoHeight || 480;
      faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
      if (results.multiFaceLandmarks?.length) {
        const lm = results.multiFaceLandmarks[0];
        drawConnectors(faceCtx, lm, FACEMESH_TESSELATION, { color: "rgba(255,255,255,.18)", lineWidth: 1 });
        const [label, command] = detectFaceGesture(lm);
        faceGesture.textContent = label;
        if (command) sendVisionCommand(command);
      } else faceGesture.textContent = "No detectado";
    });
    faceCamera = new Camera(faceVideo, {
      onFrame: async () => await mesh.send({ image: faceVideo }),
      width: 640, height: 480
    });
    faceActive = true;
    faceBtn.textContent = "🛑 Desactivar cámara";
    faceBtn.classList.add("active-camera");
    faceStatus.textContent = "Cámara facial activa. Haz un gesto.";
    faceCamera.start();
  } catch (e) {
    console.error(e);
    faceStatus.textContent = `Permiso de cámara requerido: ${e.message}`;
  }
}

function stopFace() {
  faceActive = false;
  if (faceCamera) { try { faceCamera.stop(); } catch (_) {} faceCamera = null; }
  stopVideo(faceVideo);
  faceCtx.clearRect(0, 0, faceCanvas.width, faceCanvas.height);
  faceBtn.textContent = "📷 Activar cámara facial";
  faceBtn.classList.remove("active-camera");
  faceGesture.textContent = "—";
  sendCommand("stop", true);
  faceStatus.textContent = "Cámara desactivada.";
}

faceBtn.addEventListener("click", startFace);

function sendVisionCommand(command) {
  const now = Date.now();
  if (command !== lastCommand || now - lastSentAt > 700) {
    lastSentAt = now;
    sendCommand(command, true);
  }
}

function stopVideo(video) {
  const stream = video.srcObject;
  if (stream) stream.getTracks().forEach(track => track.stop());
  video.srcObject = null;
}

function stopAllSensorsExcept(mode) {
  if (mode !== "accelerometer" && sensorActive) deactivateSensor();
  if (mode !== "voice" && voiceActive && recognition) recognition.stop();
  if (mode !== "hands" && handsActive) stopHands();
  if (mode !== "face" && faceActive) stopFace();
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (characteristic) sendCommand("stop", true);
    if (sensorActive) deactivateSensor();
    if (handsActive) stopHands();
    if (faceActive) stopFace();
    if (voiceActive && recognition) recognition.stop();
  }
});

window.addEventListener("pagehide", () => {
  if (characteristic) sendCommand("stop", true);
});
