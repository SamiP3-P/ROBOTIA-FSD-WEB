// =====================================================================
// LAB-03 Semana 3 — Robot-IA controlado por tonos
// INMP441 por I2S + FFT embebida + máquina de estados con "hombre muerto"
//
// Tonos: 650 Hz ADELANTE · 950 Hz ATRAS · 1250 Hz IZQUIERDA · 1550 Hz DERECHA
// Sin tono / ruido / tono no reconocido -> el robot se detiene.
//
// El que escucha SIEMPRE es el micrófono del robot (INMP441) y la ESP32 decide.
// La página web Robot-IA (Bluetooth) puede:
//  - Modo "Tonos": manda "tonos" -> el robot obedece a los tonos y le avisa a
//    la página cada cambio de estado (notificación BLE) para mostrarlo.
//  - Otros modos (botones, voz, etc.): mandan "ad/at/ga/gh 255" o "stop" ->
//    control manual; el detector de tonos queda en pausa.
// Sin página conectada el robot funciona solo con los tonos.
// =====================================================================
#include <Arduino.h>
#include <driver/i2s.h>
#include <arduinoFFT.h>
#include <algorithm>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ---------------- Modos de prueba ----------------
// MODO_RUIDO_MOTORES = 1 -> Parte C: motores girando fijo hacia adelante y se
//                           imprime el espectro SIN tono (no hay máquina de estados).
#define MODO_RUIDO_MOTORES 0
// DEBUG_VENTANAS = 1 -> imprime una línea por ventana (pico, relación, comando).
//                       En 0 solo se imprimen los cambios de estado.
#define DEBUG_VENTANAS     0

// ---------------- Motores (driver del Lab-02) ----------------
// GPIO0 -> IN1, GPIO1 -> IN2 (motor izquierdo) · GPIO3 -> IN3, GPIO4 -> IN4 (motor derecho)
#define PIN_IN1 0
#define PIN_IN2 1
#define PIN_IN3 3
#define PIN_IN4 4
#define VELOCIDAD      255      // 0-255: 255 = máxima velocidad
#define VELOCIDAD_GIRO 200      // giros un poco más suaves para poder controlarlos
#define PWM_FREQ       20000    // 20 kHz: fuera de la banda audible -> no "silba" en el micrófono
#define PWM_RES        8
// Si un motor gira al revés o los lados están cruzados, cambiar aquí (0/1):
#define INVERTIR_IZQ   0
#define INVERTIR_DER   0
#define CRUZAR_LADOS   0

// ---------------- Bluetooth (mismo que la página del Lab-02) ----------------
#define BLE_NOMBRE        "Robot-IA"
#define SERVICE_UUID      "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

// ---------------- I2S / FFT ----------------
#define I2S_PORT  I2S_NUM_0
#define PIN_BCLK  6   // INMP441 SCK
#define PIN_WS    7   // INMP441 WS
#define PIN_SD    10  // INMP441 SD
#define FS 16000
#define N  1024       // df = 15.6 Hz, ventana = 64 ms

// ---------------- Detector (igual que semana 2) ----------------
#define TOLERANCIA_HZ     45.0
#define UMBRAL_MAGNITUD   100000.0
#define UMBRAL_RELATIVO   10.0
#define PREENFASIS        0.97
#define BANDA_MIN_HZ      500.0
#define BANDA_MAX_HZ      1700.0
#define VENTANAS_CONFIRMA 3

struct Tono { const char* nombre; float freq; };
const Tono TONOS[] = {
  {"ADELANTE",  650.0},
  {"ATRAS",     950.0},
  {"IZQUIERDA", 1250.0},
  {"DERECHA",   1550.0},
};
const int NUM_TONOS = sizeof(TONOS) / sizeof(TONOS[0]);
const int SIN_TONO = -1;

int32_t bufferI2S[2 * N];
float vReal[N];
float vImag[N];
ArduinoFFT<float> FFT(vReal, vImag, N, FS);

// =====================================================================
// MOTORES
// Nota técnica de la guía: con I2S activo, ledcWrite(canal, 0) no siempre
// deja el PWM en 0 %. Para PARAR se desconecta el PWM del pin
// (ledcDetachPin) y se fuerza LOW; antes de mover se vuelve a conectar.
// =====================================================================
const int PINES[4] = {PIN_IN1, PIN_IN2, PIN_IN3, PIN_IN4};
bool pwmConectado = false;

void conectarPWM() {
  if (pwmConectado) return;
  for (int i = 0; i < 4; i++) {
    ledcSetup(i, PWM_FREQ, PWM_RES);
    ledcAttachPin(PINES[i], i);
    ledcWrite(i, 0);
  }
  pwmConectado = true;
}

void pararMotores() {
  for (int i = 0; i < 4; i++) {
    if (pwmConectado) ledcDetachPin(PINES[i]);
    pinMode(PINES[i], OUTPUT);
    digitalWrite(PINES[i], LOW);
  }
  pwmConectado = false;
}

// v > 0 adelante, v < 0 atrás, 0 = libre. canalA/canalB = canales de IN1/IN2 o IN3/IN4
void motor(int canalA, int canalB, int v, bool invertir) {
  if (invertir) v = -v;
  int d = constrain(abs(v), 0, 255);
  if (v >= 0) { ledcWrite(canalA, d); ledcWrite(canalB, 0); }
  else        { ledcWrite(canalA, 0); ledcWrite(canalB, d); }
}

void mover(int izq, int der) {
  conectarPWM();
#if CRUZAR_LADOS
  int t = izq; izq = der; der = t;
#endif
  motor(0, 1, izq, INVERTIR_IZQ);   // IN1, IN2
  motor(2, 3, der, INVERTIR_DER);   // IN3, IN4
}

void ejecutarComando(int tono) {
  switch (tono) {
    case 0: mover( VELOCIDAD,       VELOCIDAD);       break;  // ADELANTE
    case 1: mover(-VELOCIDAD,      -VELOCIDAD);       break;  // ATRAS
    case 2: mover(-VELOCIDAD_GIRO,  VELOCIDAD_GIRO);  break;  // IZQUIERDA (gira en su sitio)
    case 3: mover( VELOCIDAD_GIRO, -VELOCIDAD_GIRO);  break;  // DERECHA
    default: pararMotores();                          break;
  }
}

// =====================================================================
// I2S
// =====================================================================
void configurarI2S() {
  i2s_config_t config = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = FS,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,   // se usa el canal con señal
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = 0,
    .dma_buf_count = 8,
    .dma_buf_len = 256,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {
    .mck_io_num = I2S_PIN_NO_CHANGE,
    .bck_io_num = PIN_BCLK,
    .ws_io_num = PIN_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = PIN_SD
  };
  ESP_ERROR_CHECK(i2s_driver_install(I2S_PORT, &config, 0, NULL));
  ESP_ERROR_CHECK(i2s_set_pin(I2S_PORT, &pins));
  ESP_ERROR_CHECK(i2s_zero_dma_buffer(I2S_PORT));
}

void capturarVentana() {
  size_t total = 0;
  uint8_t* destino = (uint8_t*)bufferI2S;
  while (total < sizeof(bufferI2S)) {
    size_t leidos = 0;
    i2s_read(I2S_PORT, destino + total, sizeof(bufferI2S) - total, &leidos, portMAX_DELAY);
    total += leidos;
  }
  double e[2] = {0, 0};
  for (int c = 0; c < 2; c++) {
    double m = 0;
    for (int i = 0; i < N; i++) m += (bufferI2S[2 * i + c] >> 8);
    m /= N;
    for (int i = 0; i < N; i++) { double d = (bufferI2S[2 * i + c] >> 8) - m; e[c] += d * d; }
  }
  int canal = (e[1] > e[0]) ? 1 : 0;
  for (int i = 0; i < N; i++) vReal[i] = (float)(bufferI2S[2 * i + canal] >> 8);
}

// =====================================================================
// DETECTOR: devuelve el índice del tono (0-3) o SIN_TONO
// =====================================================================
float ultimaFreq = 0, ultimaRel = 0, ultimaMag = 0;

int detectarTono() {
  float media = 0;
  for (int i = 0; i < N; i++) media += vReal[i];
  media /= N;
  for (int i = 0; i < N; i++) { vReal[i] -= media; vImag[i] = 0; }
  for (int i = N - 1; i > 0; i--) vReal[i] -= PREENFASIS * vReal[i - 1];
  vReal[0] = 0;

  FFT.windowing(FFTWindow::Hamming, FFTDirection::Forward);
  FFT.compute(FFTDirection::Forward);
  FFT.complexToMagnitude();

  const float df = (float)FS / N;
  const int kMin = (int)(BANDA_MIN_HZ / df), kMax = (int)(BANDA_MAX_HZ / df);
  static float copia[128];
  int nb = 0;
  for (int k = kMin; k <= kMax && nb < 128; k++) copia[nb++] = vReal[k];
  std::nth_element(copia, copia + nb / 2, copia + nb);
  float ruido = copia[nb / 2];

  int mejor = SIN_TONO, kPico = kMin;
  float mejorRel = 0;
  for (int t = 0; t < NUM_TONOS; t++) {
    int k0 = (int)((TONOS[t].freq - TOLERANCIA_HZ) / df), k1 = (int)((TONOS[t].freq + TOLERANCIA_HZ) / df);
    for (int k = k0; k <= k1; k++) {
      float rel = (ruido > 0) ? vReal[k] / ruido : 0;
      if (rel > mejorRel) { mejorRel = rel; mejor = t; kPico = k; }
    }
  }
  float a = vReal[kPico - 1], b = vReal[kPico], c = vReal[kPico + 1];
  float den = a - 2 * b + c;
  ultimaFreq = (kPico + ((den != 0) ? 0.5f * (a - c) / den : 0)) * df;
  ultimaMag = b;
  ultimaRel = mejorRel;

  if (mejor >= 0 && mejorRel >= UMBRAL_RELATIVO && b >= UMBRAL_MAGNITUD) return mejor;
  return SIN_TONO;
}

// =====================================================================
// MÁQUINA DE ESTADOS (un paso por cada ventana de FFT, sin delay())
// =====================================================================
void avisarPagina(const char* msg);       // definida en la sección BLE

enum Estado { REPOSO, VALIDANDO, MOVIENDO };
const char* NOMBRE_ESTADO[] = {"REPOSO", "VALIDANDO", "MOVIENDO"};
Estado estado = REPOSO;
int tonoActual = SIN_TONO;
int contador = 0;

void cambiarEstado(Estado nuevo, int tono) {
  char msg[64];
  if (tono >= 0)
    snprintf(msg, sizeof(msg), "%s %s %.0f Hz", NOMBRE_ESTADO[nuevo], TONOS[tono].nombre, ultimaFreq);
  else
    snprintf(msg, sizeof(msg), "%s sin tono", NOMBRE_ESTADO[nuevo]);
  Serial.printf("%s -> %s\n", NOMBRE_ESTADO[estado], msg);
  estado = nuevo;
  avisarPagina(msg);                        // la página muestra lo que detectó el robot
}

void pasoMaquina(int tono) {
  switch (estado) {
    case REPOSO:
      if (tono != SIN_TONO) {
        tonoActual = tono; contador = 1;
        cambiarEstado(VALIDANDO, tono);
      }
      break;

    case VALIDANDO:
      if (tono == SIN_TONO) {                 // silencio o ruido
        cambiarEstado(REPOSO, SIN_TONO);
        tonoActual = SIN_TONO; contador = 0;
      } else if (tono != tonoActual) {        // otro tono: reinicia en 1
        tonoActual = tono; contador = 1;
        Serial.printf("VALIDANDO: cambio de tono -> %s, cont = 1\n", TONOS[tono].nombre);
      } else if (++contador >= VENTANAS_CONFIRMA) {
        cambiarEstado(MOVIENDO, tono);
        ejecutarComando(tonoActual);
      }
      break;

    case MOVIENDO:
      if (tono == tonoActual) break;          // mismo tono: sigue moviendo
      pararMotores();                         // hombre muerto: cualquier otra cosa detiene
      if (tono == SIN_TONO) {
        cambiarEstado(REPOSO, SIN_TONO);
        tonoActual = SIN_TONO; contador = 0;
      } else {                                // otro tono válido: para y valida de nuevo
        cambiarEstado(VALIDANDO, tono);
        tonoActual = tono; contador = 1;
      }
      break;
  }
}

// =====================================================================
// BLUETOOTH: recibe "ad 150", "at 150", "ga 150", "gh 150" o "stop"
// El callback corre en la tarea de BLE; solo guarda el comando y el loop
// lo aplica (así no se tocan los motores desde dos tareas a la vez).
// =====================================================================
volatile bool bleConectado = false;
bool modoTonos = true;                      // true = manda el micrófono del robot
BLECharacteristic* caracteristica = nullptr;
volatile bool bleNuevo = false;
volatile bool bleDesconectado = false;
char bleComando[24] = "stop";

class ServidorCB : public BLEServerCallbacks {
  void onConnect(BLEServer*) override { bleConectado = true; }
  void onDisconnect(BLEServer* s) override {
    bleConectado = false; bleDesconectado = true;
    s->getAdvertising()->start();           // vuelve a anunciarse para reconectar
  }
};

class ComandoCB : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* c) override {
    std::string v = c->getValue();
    size_t n = std::min(v.size(), sizeof(bleComando) - 1);
    memcpy(bleComando, v.data(), n);
    bleComando[n] = 0;
    bleNuevo = true;
  }
};

void iniciarBLE() {
  BLEDevice::init(BLE_NOMBRE);
  BLEServer* servidor = BLEDevice::createServer();
  servidor->setCallbacks(new ServidorCB());
  BLEService* servicio = servidor->createService(SERVICE_UUID);
  BLECharacteristic* car = servicio->createCharacteristic(
      CHARACTERISTIC_UUID,
      BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_WRITE |
      BLECharacteristic::PROPERTY_WRITE_NR | BLECharacteristic::PROPERTY_NOTIFY);
  car->addDescriptor(new BLE2902());        // permite que la página reciba avisos
  car->setCallbacks(new ComandoCB());
  caracteristica = car;
  car->setValue("stop");
  servicio->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->setScanResponse(true);
  BLEDevice::startAdvertising();
}

void avisarPagina(const char* msg) {
  if (!bleConectado || caracteristica == nullptr) return;
  caracteristica->setValue(msg);
  caracteristica->notify();
}

// Aplica un comando de la página: "ad 200" -> adelante a 200, etc.
void aplicarComandoBLE(const char* cmd) {
  int vel = VELOCIDAD;
  const char* esp = strchr(cmd, ' ');
  if (esp) vel = constrain(atoi(esp + 1), 0, 255);
  if      (strncmp(cmd, "ad", 2) == 0) mover( vel,  vel);
  else if (strncmp(cmd, "at", 2) == 0) mover(-vel, -vel);
  else if (strncmp(cmd, "ga", 2) == 0) mover(-vel,  vel);
  else if (strncmp(cmd, "gh", 2) == 0) mover( vel, -vel);
  else pararMotores();                      // "stop" o cualquier cosa desconocida
  Serial.printf("BLE: %s\n", cmd);
}

// =====================================================================
void setup() {
  Serial.begin(115200);
  pararMotores();                 // arranca con los motores apagados
  delay(1500);                    // solo en el arranque, nunca en el ciclo
  Serial.println();
  Serial.println("=== LAB-03 SEMANA 3: Robot-IA por tonos ===");
  Serial.println("650 ADELANTE | 950 ATRAS | 1250 IZQUIERDA | 1550 DERECHA | sin tono = PARAR");
  configurarI2S();
  iniciarBLE();
  Serial.println("Bluetooth listo: busca \"Robot-IA\" desde la página web");
#if MODO_RUIDO_MOTORES
  Serial.println("MODO RUIDO DE MOTORES: motores adelante a velocidad fija, SIN tono");
  ejecutarComando(0);
#endif
  Serial.println("Estado inicial: REPOSO");
}

void loop() {
  // ----- Comandos de la página web (Bluetooth) -----
  if (bleDesconectado) {                    // se cayó la conexión: parar y volver a tonos
    bleDesconectado = false;
    pararMotores();
    modoTonos = true;
    estado = REPOSO; tonoActual = SIN_TONO; contador = 0;
    Serial.println("BLE desconectado -> motores parados, control por tonos");
  }
  if (bleNuevo) {
    bleNuevo = false;
    char cmd[24];
    strncpy(cmd, bleComando, sizeof(cmd));
    if (strncmp(cmd, "tonos", 5) == 0) {    // la página activó el modo Tonos
      modoTonos = true;
      pararMotores();
      estado = REPOSO; tonoActual = SIN_TONO; contador = 0;
      Serial.println("Página: modo TONOS (manda el micrófono del robot)");
      avisarPagina("REPOSO esperando tono");
    } else {                                // botones, voz, etc.: control manual
      modoTonos = false;
      aplicarComandoBLE(cmd);
    }
  }
  if (!modoTonos) { delay(5); return; }     // en manual no se procesan tonos

  // ----- Control por el micrófono del robot (semana 3) -----
  capturarVentana();
  int tono = detectarTono();

#if MODO_RUIDO_MOTORES
  // Parte C: espectro sin tono con motores encendidos
  Serial.printf("RUIDO | pico %7.1f Hz | mag %10.0f | x%5.1f | %s\n", ultimaFreq, ultimaMag, ultimaRel,
                tono >= 0 ? TONOS[tono].nombre : "SILENCIO");
  return;
#endif

#if DEBUG_VENTANAS
  Serial.printf("  [%s] pico %7.1f Hz | x%5.1f | %s | cont %d\n", NOMBRE_ESTADO[estado], ultimaFreq,
                ultimaRel, tono >= 0 ? TONOS[tono].nombre : "SILENCIO", contador);
#endif
  pasoMaquina(tono);
}
