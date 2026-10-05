# 🚗 Smart Parking System (IoT + Cloud Web Application)

A full-stack Internet of Things (IoT) Smart Parking System built with **ESP8266 (NodeMCU)**, **IR Sensors**, **16×2 I2C LCD**, **LEDs**, **Node.js Express**, and **SQLite**. Designed for direct deployment on **Render** cloud platform.

---

## 📁 Project Folder Structure

```text
Parking_slots/
│
├── server.js                  # Node.js + Express backend with SQLite and REST APIs
├── package.json               # Project configuration and Render start scripts
├── parking.db                 # SQLite database (auto-generated on start)
├── .env.example               # Environment variables template
├── .gitignore                 # Git ignore file for node_modules and logs
├── README.md                  # Comprehensive setup and deployment guide
│
├── public/                    # Frontend Web Application (Purpled-Themed)
│   ├── index.html             # Modern Login & Registration Page
│   ├── dashboard.html         # Smart Parking Dashboard (3 Tabs + Real-Time Sync)
│   ├── style.css              # Custom styling, animations, light/dark themes
│   └── script.js              # Real-time polling, slot reservation & cancellation logic
│
└── esp8266/
    └── smart_parking.ino      # ESP8266 Arduino sketch (Sensors, LCD, LEDs, HTTPS)
```

---

## 🔌 Hardware Components & Wiring Instructions

### Components Required
- 1 × NodeMCU ESP8266 (v2 or v3)
- 2 × Digital IR Obstacle Sensors (Slot 1 & Slot 2)
- 1 × 16×2 LCD with I2C Module (PCF8574, default address `0x27`)
- 2 × LEDs (Red/Yellow/Green)
- 2 × 220Ω–330Ω Resistors (for LEDs)
- 1 × Breadboard
- Jumper Wires & Micro-USB Cable

### Wiring Table

| Component | Pin on Component | ESP8266 (NodeMCU) Pin | GPIO Pin | Notes |
|---|---|---|---|---|
| **IR Sensor 1** (Slot 1) | OUT / DATA | **D5** | GPIO 14 | Digital Input |
| **IR Sensor 1** | VCC | **3V3** or **Vin** | - | Power |
| **IR Sensor 1** | GND | **GND** | - | Ground |
| **IR Sensor 2** (Slot 2) | OUT / DATA | **D6** | GPIO 12 | Digital Input |
| **IR Sensor 2** | VCC | **3V3** or **Vin** | - | Power |
| **IR Sensor 2** | GND | **GND** | - | Ground |
| **16×2 I2C LCD** | SDA | **D2** | GPIO 4 | I2C Data |
| **16×2 I2C LCD** | SCL | **D1** | GPIO 5 | I2C Clock |
| **16×2 I2C LCD** | VCC | **Vin (5V)** | - | 5V Power for bright backlight |
| **16×2 I2C LCD** | GND | **GND** | - | Ground |
| **LED 1** (Slot 1) | Anode (+) via 220Ω | **D7** | GPIO 13 | Cathode (-) to GND |
| **LED 2** (Slot 2) | Anode (+) via 220Ω | **D8** | GPIO 15 | Cathode (-) to GND |

> **Tip on IR Sensors:** Adjust the small potentiometer on each IR sensor with a small screwdriver so that the onboard detection LED turns ON only when a model car/hand is directly in the parking bay (approx 2–6 cm).

---

## ⚙️ Hardware Display & LED Logic

### 16×2 I2C LCD Cycling Display
The LCD displays real-time parking data received from the NodeMCU and cloud server:
1. **Startup (3 sec):**
   ```text
   SMART PARKING
   SYSTEM
   ```
2. **WiFi Connecting:**
   ```text
   CONNECTING TO
   WiFi........
   ```
3. **WiFi Connected:**
   ```text
   WiFi
   CONNECTED
   ```
4. **Main Operation Loop (Cycles every 2.5 seconds):**
   - **Screen 1 (Slot Status):**
     ```text
     S1: AVAILABLE
     S2: OCCUPIED
     ```
   - **Screen 2 (Totals):**
     ```text
     TOTAL: 2
     AVAIL: 1
     ```
   - **Screen 3 (Res & Occ):**
     ```text
     RES: 0
     OCC: 1
     ```

### LED Indicators
- **LED 1 (D7) / LED 2 (D8):**
  - **LED ON:** Slot is **OCCUPIED** (Vehicle detected) or **RESERVED** via website.
  - **LED OFF:** Slot is **AVAILABLE** (Free).

---

## 🚦 Status Determination Logic

| Vehicle Detected (IR) | Reserved via Web | Final Status | Action on Web | LED Status |
|---|---|---|---|---|
| **No** | **No** | 🟢 **AVAILABLE** | Can Reserve Slot | **OFF** |
| **No** | **Yes** | 🟡 **RESERVED** | Can Cancel Reservation | **ON** |
| **Yes** | **No** | 🔴 **OCCUPIED** | Not Available (Disabled) | **ON** |
| **Yes** | **Yes** | 🔴 **OCCUPIED** | Not Available (Reservation kept) | **ON** |

---

## 💻 Local Setup & Running in VS Code

### Step 1: Open in VS Code
Open the project directory in VS Code:
```bash
cd "c:\Users\PRACHI\Desktop\Parking_slots"
```

### Step 2: Install Node.js Dependencies
```bash
npm install
```

### Step 3: Start Local Server
```bash
npm start
```
The server will start on port 3000:
```text
===============================================
🚗 Smart Parking System Server Running
Port: 3000
Local Access: http://localhost:3000
===============================================
```

### Step 4: Open in Web Browser
Open your browser and navigate to:
```text
http://localhost:3000
```
- **Quick Demo Credentials:**
  - Email: `user@parking.com`
  - Password: `password123`
  - Or click **Register** to create any new user account!

---

## ☁️ Render Cloud Deployment Guide

This application is built to run directly on **Render** as a free Web Service.

### Step 1: Push your code to GitHub
1. Create a new repository on [GitHub](https://github.com/new) (e.g., `smart-parking-system`).
2. In your local terminal, initialize and push:
   ```bash
   git init
   git add .
   git commit -m "Initial commit for Smart Parking System"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/smart-parking-system.git
   git push -u origin main
   ```

### Step 2: Create Web Service on Render
1. Go to [Render Dashboard](https://dashboard.render.com/) and click **New +** → **Web Service**.
2. Connect your GitHub repository.
3. Configure the settings:
   - **Name:** `smart-parking-system` (or your choice)
   - **Region:** Any (e.g., Singapore or Frankfurt)
   - **Branch:** `main`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** `Free`
4. Click **Deploy Web Service**.
5. Once deployment completes, copy your live Render URL:
   ```text
   https://smart-parking-system.onrender.com
   ```

---

## 📡 ESP8266 Arduino IDE Setup & Flashing

### Step 1: Install Arduino IDE and ESP8266 Board Core
1. In Arduino IDE, go to **File** → **Preferences**.
2. In **Additional Boards Manager URLs**, add:
   ```text
   http://arduino.esp8266.com/stable/package_esp8266com_index.json
   ```
3. Go to **Tools** → **Board** → **Boards Manager...**, search for `ESP8266` and install.
4. Select board: **Tools** → **Board** → **ESP8266 Boards** → **NodeMCU 1.0 (ESP-12E Module)**.

### Step 2: Install Required Arduino Libraries
Go to **Sketch** → **Include Library** → **Manage Libraries...** and install:
1. **ArduinoJson** (by Benoit Blanchon, v6 or v7)
2. **LiquidCrystal_I2C** (by Frank de Brabander)

### Step 3: Configure `esp8266/smart_parking.ino`
Open `esp8266/smart_parking.ino` and update your WiFi and Server URL:
```cpp
// Your WiFi Credentials
const char* WIFI_SSID     = "MyHomeWiFi";
const char* WIFI_PASSWORD = "MySecretPassword";

// Your Render Deployed URL (or local IP for testing)
const char* SERVER_URL    = "https://smart-parking-system.onrender.com";
```

### Step 4: Upload to NodeMCU
1. Connect NodeMCU via USB.
2. Select the correct COM Port (**Tools** → **Port**).
3. Click **Upload** (Arrow icon).
4. Open **Serial Monitor** (Baud rate: **115200**) to see live boot and HTTP messages.

---

## 🔗 REST API Reference

| Endpoint | Method | Sender | Description |
|---|---|---|---|
| `/api/auth/register` | `POST` | Web | Register a new user (`name`, `email`, `password`) |
| `/api/auth/login` | `POST` | Web | Log in existing user (`email`, `password`) |
| `/api/auth/me` | `GET` | Web | Get profile of logged-in user |
| `/api/parking/update` | `POST` | ESP8266 | Sends IR readings: `{"slot1": {"vehicleDetected": true}, "slot2": {"vehicleDetected": false}}` |
| `/api/parking/status` | `GET` | ESP8266 / Web | Returns live counts, slot statuses, and ESP8266 online/offline status |
| `/api/parking/reserve` | `POST` | Web | Reserve slot: `{"slot": 1}` |
| `/api/parking/cancel` | `POST` | Web | Cancel reservation: `{"slot": 1}` |
| `/api/parking/slots` | `GET` | Web | Tab 2: Detailed slots table telemetry |
| `/api/parking/reservations`| `GET` | Web | Tab 3: Detailed reservation log (IST timestamp) |
