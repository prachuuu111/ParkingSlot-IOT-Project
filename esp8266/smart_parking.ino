/*
 * =====================================================================================
 * Project: Smart Parking System (IoT + Web Application)
 * Microcontroller: ESP8266 (NodeMCU v2 / v3)
 * Author: Smart Parking IoT
 * Compatible with: Arduino IDE 1.8.x / 2.x, ESP8266 Board Core (v3.x+)
 * Libraries Required:
 *   - ESP8266WiFi (Built-in with ESP8266 board core)
 *   - ESP8266HTTPClient (Built-in with ESP8266 board core)
 *   - WiFiClientSecure (Built-in with ESP8266 board core)
 *   - ArduinoJson (Install via Library Manager: ArduinoJson by Benoit Blanchon v6 or v7)
 *   - LiquidCrystal_I2C (Install via Library Manager: LiquidCrystal_I2C by Frank de Brabander)
 *   - Wire (Built-in for I2C)
 * =====================================================================================
 * 
 * HARDWARE PIN CONNECTIONS (NodeMCU):
 * -------------------------------------------------------------------------------------
 * 1. IR Sensor 1 (Slot 1)  -> D5 (GPIO 14)
 * 2. IR Sensor 2 (Slot 2)  -> D6 (GPIO 12)
 * 3. 16x2 I2C LCD SDA      -> D2 (GPIO 4)
 * 4. 16x2 I2C LCD SCL      -> D1 (GPIO 5)
 * 5. LED 1 (Slot 1 Status) -> D7 (GPIO 13) [via 220Ω - 330Ω resistor]
 * 6. LED 2 (Slot 2 Status) -> D8 (GPIO 15) [via 220Ω - 330Ω resistor]
 * 7. Power Supply:
 *    - NodeMCU Vin / 3V3 / GND
 *    - LCD VCC -> 5V (Vin) or 3.3V, GND -> GND
 *    - IR Sensors VCC -> 3.3V or 5V, GND -> GND
 * =====================================================================================
 */

#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <ArduinoJson.h>

// ==========================================
// 1. USER CONFIGURATION (WIFI & SERVER)
// ==========================================
// Enter your WiFi Network Name and Password
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Enter your Server URL:
// For LIVE RENDER Deployment:
// const char* SERVER_URL = "https://smart-parking-system.onrender.com";
//
// For LOCAL TESTING (Same WiFi as your PC):
// const char* SERVER_URL = "http://192.168.1.100:3000";
const char* SERVER_URL = "YOUR_RENDER_URL";

// ==========================================
// 2. HARDWARE PIN DEFINITIONS
// ==========================================
#define IR_PIN_1   D5  // IR Sensor 1 for Parking Slot 1 (GPIO 14)
#define IR_PIN_2   D6  // IR Sensor 2 for Parking Slot 2 (GPIO 12)
#define LED_PIN_1  D7  // LED for Slot 1 (GPIO 13)
#define LED_PIN_2  D8  // LED for Slot 2 (GPIO 15)

// Standard Digital IR proximity sensors output LOW (0) when a vehicle/object is detected,
// and HIGH (1) when the parking slot is empty.
// If your IR sensor uses opposite logic, change LOW to HIGH.
const int IR_DETECTED_LEVEL = LOW;

// ==========================================
// 3. LCD CONFIGURATION (16x2 I2C)
// ==========================================
// Standard I2C address is 0x27. If your display remains blank, try 0x3F.
LiquidCrystal_I2C lcd(0x27, 16, 2);

// ==========================================
// 4. GLOBAL STATE VARIABLES
// ==========================================
// Slot states received from Server
String slot1Status = "AVAILABLE";
String slot2Status = "AVAILABLE";
bool slot1Reserved = false;
bool slot2Reserved = false;
bool slot1Vehicle  = false;
bool slot2Vehicle  = false;

int totalSlots    = 2;
int availableSlots = 2;
int reservedSlots  = 0;
int occupiedSlots  = 0;

// Non-blocking timer variables
unsigned long lastServerSyncTime = 0;
const unsigned long SERVER_SYNC_INTERVAL = 2000; // Sync with server every 2 seconds

unsigned long lastLcdCycleTime   = 0;
const unsigned long LCD_CYCLE_INTERVAL  = 2500; // Cycle LCD screens every 2.5 seconds
int lcdScreenIndex = 0; // 0 = Slot Details, 1 = Totals, 2 = Res & Occ

// Previous sensor readings for change detection
bool lastV1 = false;
bool lastV2 = false;

// ==========================================
// 5. HELPER FUNCTION: HTTP CLIENT SETUP
// ==========================================
// Handles both HTTP (local testing) and HTTPS (Render Cloud with SSL)
bool makeHttpRequest(const String& endpoint, const String& method, const String& payload, String& response) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  String fullUrl = String(SERVER_URL) + endpoint;
  bool isHttps = fullUrl.startsWith("https://");

  HTTPClient http;
  bool success = false;

  if (isHttps) {
    WiFiClientSecure secureClient;
    secureClient.setInsecure(); // Bypass SSL thumbprint check for Render certificates
    secureClient.setTimeout(5000);

    if (http.begin(secureClient, fullUrl)) {
      http.setTimeout(5000);
      http.setUserAgent("ESP8266-SmartParking");
      http.addHeader("Content-Type", "application/json");

      int httpCode = -1;
      if (method == "POST") {
        httpCode = http.POST(payload);
      } else {
        httpCode = http.GET();
      }

      if (httpCode > 0) {
        response = http.getString();
        success = (httpCode >= 200 && httpCode < 300);
      } else {
        Serial.printf("[HTTP] HTTPS request failed, error: %s\n", http.errorToString(httpCode).c_str());
      }
      http.end();
    }
  } else {
    WiFiClient standardClient;
    standardClient.setTimeout(5000);

    if (http.begin(standardClient, fullUrl)) {
      http.setTimeout(5000);
      http.setUserAgent("ESP8266-SmartParking");
      http.addHeader("Content-Type", "application/json");

      int httpCode = -1;
      if (method == "POST") {
        httpCode = http.POST(payload);
      } else {
        httpCode = http.GET();
      }

      if (httpCode > 0) {
        response = http.getString();
        success = (httpCode >= 200 && httpCode < 300);
      } else {
        Serial.printf("[HTTP] HTTP request failed, error: %s\n", http.errorToString(httpCode).c_str());
      }
      http.end();
    }
  }

  return success;
}

// ==========================================
// 6. SERVER COMMUNICATION FUNCTIONS
// ==========================================
// Step 3 in loop: Send sensor detection data to Server (POST /api/parking/update)
void sendSensorUpdateToServer(bool v1Detected, bool v2Detected) {
  // Construct JSON payload
  // { "slot1": { "vehicleDetected": true/false }, "slot2": { "vehicleDetected": true/false } }
  StaticJsonDocument<256> doc;
  JsonObject s1 = doc.createNestedObject("slot1");
  s1["vehicleDetected"] = v1Detected;

  JsonObject s2 = doc.createNestedObject("slot2");
  s2["vehicleDetected"] = v2Detected;

  String jsonPayload;
  serializeJson(doc, jsonPayload);

  String response;
  bool ok = makeHttpRequest("/api/parking/update", "POST", jsonPayload, response);

  if (ok) {
    Serial.println("[ESP8266] Sensor update successfully posted to Server.");
  } else {
    Serial.println("[ESP8266] Failed to post sensor update to Server.");
  }
}

// Step 4 in loop: Fetch latest parking and reservation status (GET /api/parking/status)
void fetchParkingStatusFromServer() {
  String response;
  bool ok = makeHttpRequest("/api/parking/status?caller=esp8266", "GET", "", response);

  if (!ok) {
    Serial.println("[ESP8266] Status GET failed.");
    return;
  }

  // Parse JSON response from Node.js Express Server
  StaticJsonDocument<768> doc;
  DeserializationError err = deserializeJson(doc, response);

  if (err) {
    Serial.print("[JSON] Parse error: ");
    Serial.println(err.c_str());
    return;
  }

  // Extract Summary KPI Counts
  totalSlots     = doc["totalSlots"] | 2;
  availableSlots = doc["availableSlots"] | 0;
  reservedSlots  = doc["reservedSlots"] | 0;
  occupiedSlots  = doc["occupiedSlots"] | 0;

  // Extract Slot 1 details
  if (doc["slots"]["slot1"]) {
    String st1 = doc["slots"]["slot1"]["status"].as<String>();
    st1.toUpperCase();
    slot1Status   = st1;
    slot1Reserved = doc["slots"]["slot1"]["reserved"] | false;
    slot1Vehicle  = doc["slots"]["slot1"]["vehicleDetected"] | false;
  }

  // Extract Slot 2 details
  if (doc["slots"]["slot2"]) {
    String st2 = doc["slots"]["slot2"]["status"].as<String>();
    st2.toUpperCase();
    slot2Status   = st2;
    slot2Reserved = doc["slots"]["slot2"]["reserved"] | false;
    slot2Vehicle  = doc["slots"]["slot2"]["vehicleDetected"] | false;
  }

  Serial.printf("[SYNC] S1: %s | S2: %s | Avail: %d | Res: %d | Occ: %d\n",
    slot1Status.c_str(), slot2Status.c_str(), availableSlots, reservedSlots, occupiedSlots);
}

// ==========================================
// 7. HARDWARE LED CONTROLLER
// ==========================================
// Step 5 in loop: Update LEDs based on current slot state
// Basic Hardware Version:
// LED ON  -> Slot is occupied OR reserved
// LED OFF -> Slot is available
void updateLeds() {
  // Slot 1 LED (D7)
  if (slot1Status == "OCCUPIED" || slot1Status == "RESERVED") {
    digitalWrite(LED_PIN_1, HIGH);
  } else {
    digitalWrite(LED_PIN_1, LOW);
  }

  // Slot 2 LED (D8)
  if (slot2Status == "OCCUPIED" || slot2Status == "RESERVED") {
    digitalWrite(LED_PIN_2, HIGH);
  } else {
    digitalWrite(LED_PIN_2, LOW);
  }
}

// ==========================================
// 8. LCD DISPLAY CYCLING (16x2 I2C)
// ==========================================
// Helper to format 16-character padded strings for clean display
void lcdPrintLine(int line, String text) {
  lcd.setCursor(0, line);
  while (text.length() < 16) {
    text += " ";
  }
  lcd.print(text.substring(0, 16));
}

// Step 6 in loop: Non-blocking LCD cycling through 3 views:
// Screen 1:
//   S1: AVAILABLE
//   S2: OCCUPIED
// Screen 2:
//   TOTAL: 2
//   AVAIL: 1
// Screen 3:
//   RES: 0
//   OCC: 1
void updateLcdCycle() {
  unsigned long now = millis();
  if (now - lastLcdCycleTime < LCD_CYCLE_INTERVAL) {
    return;
  }
  lastLcdCycleTime = now;

  switch (lcdScreenIndex) {
    case 0:
      // Screen 1: Individual Slot Status
      lcdPrintLine(0, "S1: " + slot1Status);
      lcdPrintLine(1, "S2: " + slot2Status);
      lcdScreenIndex = 1;
      break;

    case 1:
      // Screen 2: Total & Available
      lcdPrintLine(0, "TOTAL: " + String(totalSlots));
      lcdPrintLine(1, "AVAIL: " + String(availableSlots));
      lcdScreenIndex = 2;
      break;

    case 2:
      // Screen 3: Reserved & Occupied
      lcdPrintLine(0, "RES: " + String(reservedSlots));
      lcdPrintLine(1, "OCC: " + String(occupiedSlots));
      lcdScreenIndex = 0;
      break;
  }
}

// ==========================================
// 9. SETUP FUNCTION
// ==========================================
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n--- SMART PARKING SYSTEM INITIALIZING ---");

  // 1. Initialize GPIO Pins
  pinMode(IR_PIN_1, INPUT);
  pinMode(IR_PIN_2, INPUT);
  pinMode(LED_PIN_1, OUTPUT);
  pinMode(LED_PIN_2, OUTPUT);

  // Turn LEDs off initially
  digitalWrite(LED_PIN_1, LOW);
  digitalWrite(LED_PIN_2, LOW);

  // 2. Initialize 16x2 I2C LCD (SDA on D2, SCL on D1)
  Wire.begin(D2, D1);
  lcd.init();
  lcd.backlight();
  lcd.clear();

  // Startup Screen
  // SMART PARKING
  // SYSTEM
  // Delay 3 seconds
  lcdPrintLine(0, " SMART PARKING  ");
  lcdPrintLine(1, "     SYSTEM     ");
  Serial.println("[LCD] Displaying Startup Banner (3s)...");
  delay(3000);

  // 3. Connect to WiFi
  // CONNECTING TO
  // WiFi........
  lcd.clear();
  lcdPrintLine(0, "CONNECTING TO   ");
  lcdPrintLine(1, "WiFi........    ");
  Serial.printf("[WIFI] Connecting to SSID: %s\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 40) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  lcd.clear();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WIFI] Connected Successfully!");
    Serial.print("[WIFI] IP Address: ");
    Serial.println(WiFi.localIP());

    // After Connection
    // WiFi
    // CONNECTED
    lcdPrintLine(0, "WiFi            ");
    lcdPrintLine(1, "CONNECTED       ");
    delay(1500);
  } else {
    Serial.println("\n[WIFI] Connection Timeout. Running in offline/retry mode.");
    lcdPrintLine(0, "WiFi ERROR      ");
    lcdPrintLine(1, "RETRYING...     ");
    delay(1500);
  }

  // Initial read of sensors and server sync
  bool v1 = (digitalRead(IR_PIN_1) == IR_DETECTED_LEVEL);
  bool v2 = (digitalRead(IR_PIN_2) == IR_DETECTED_LEVEL);
  lastV1 = v1;
  lastV2 = v2;

  sendSensorUpdateToServer(v1, v2);
  fetchParkingStatusFromServer();
  updateLeds();
  updateLcdCycle();
}

// ==========================================
// 10. MAIN ESP8266 CONTINUOUS LOOP
// ==========================================
void loop() {
  // Check WiFi connection and auto-reconnect if lost
  if (WiFi.status() != WL_CONNECTED) {
    static unsigned long lastWifiRetry = 0;
    if (millis() - lastWifiRetry > 10000) {
      lastWifiRetry = millis();
      Serial.println("[WIFI] Reconnecting...");
      WiFi.reconnect();
    }
  }

  // 1. Read IR Sensors continuously
  bool currentV1 = (digitalRead(IR_PIN_1) == IR_DETECTED_LEVEL);
  bool currentV2 = (digitalRead(IR_PIN_2) == IR_DETECTED_LEVEL);

  // 2. Determine vehicle status and detect immediate physical entry/exit
  bool stateChanged = (currentV1 != lastV1) || (currentV2 != lastV2);

  // 3. Periodic Server Communication & Sensor Sync
  unsigned long now = millis();
  if (stateChanged || (now - lastServerSyncTime >= SERVER_SYNC_INTERVAL)) {
    lastServerSyncTime = now;
    lastV1 = currentV1;
    lastV2 = currentV2;

    Serial.printf("[SENSORS] Slot 1 Car: %s | Slot 2 Car: %s\n",
      currentV1 ? "DETECTED" : "CLEAR",
      currentV2 ? "DETECTED" : "CLEAR");

    // 3. Send sensor data to server (POST /api/parking/update)
    sendSensorUpdateToServer(currentV1, currentV2);

    // 4. Fetch latest reservation and status from server (GET /api/parking/status)
    fetchParkingStatusFromServer();

    // 5. Update LEDs according to Available, Reserved, or Occupied
    updateLeds();
  }

  // 6. Update LCD Display (cyclically shows Slot Status, Totals, Res/Occ)
  updateLcdCycle();

  // Small non-blocking delay to yield ESP8266 background tasks (WiFi stack)
  delay(10);
}
