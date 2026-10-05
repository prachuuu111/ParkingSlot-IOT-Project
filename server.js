require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Database initialization
const dbPath = path.join(__dirname, 'parking.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('Connected to SQLite database at:', dbPath);
    initializeDatabase();
  }
});

// Helper for Indian Standard Time (Asia/Kolkata UTC +5:30)
function getISTDateTime() {
  return new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

function getISTDate() {
  return new Date().toLocaleDateString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit'
  });
}

function getISTTime() {
  return new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: true
  });
}

// Password hashing & Token authentication
const JWT_SECRET = process.env.JWT_SECRET || 'smart_parking_secret_key_render_2026';

function hashPassword(password) {
  return crypto.createHash('sha256').update(password + '_salt_iot_parking').digest('hex');
}

function generateToken(user) {
  const payload = {
    id: user.id,
    name: user.name,
    email: user.email,
    iat: Date.now()
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('base64url');
  return `${b64}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [b64, signature] = parts;
  const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(b64).digest('base64url');
  if (signature !== expectedSignature) return null;
  try {
    const json = Buffer.from(b64, 'base64url').toString('utf8');
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// Auth middleware (extracts user if present)
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer ')) 
    ? authHeader.slice(7) 
    : (req.query.token || req.body.token);

  if (!token) {
    return res.status(401).json({ success: false, message: 'Authentication required. Please log in.' });
  }

  const user = verifyToken(token);
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid or expired session. Please log in again.' });
  }

  req.user = user;
  next();
}

// Optional Auth (doesn't fail if token missing, but attaches req.user if valid)
function optionalAuthMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = (authHeader && authHeader.startsWith('Bearer ')) 
    ? authHeader.slice(7) 
    : (req.query.token || req.body.token);

  if (token) {
    const user = verifyToken(token);
    if (user) req.user = user;
  }
  next();
}

// Database Schema Setup
function initializeDatabase() {
  db.serialize(() => {
    // 1. Slots Table
    db.run(`
      CREATE TABLE IF NOT EXISTS slots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_number INTEGER UNIQUE NOT NULL,
        status TEXT NOT NULL DEFAULT 'available',
        vehicle_detected INTEGER NOT NULL DEFAULT 0,
        reserved INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      )
    `);

    // 2. Users Table
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    // 3. Reservations Table
    db.run(`
      CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot_number INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        reserved_at TEXT NOT NULL,
        cancelled_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `);

    // Seed Slots 1 & 2 if not present
    const now = getISTDateTime();
    db.run(`
      INSERT OR IGNORE INTO slots (slot_number, status, vehicle_detected, reserved, updated_at)
      VALUES (1, 'available', 0, 0, ?)
    `, [now]);

    db.run(`
      INSERT OR IGNORE INTO slots (slot_number, status, vehicle_detected, reserved, updated_at)
      VALUES (2, 'available', 0, 0, ?)
    `, [now]);

    // Seed default demo user for easy initial login
    const defaultPassword = hashPassword('password123');
    db.run(`
      INSERT OR IGNORE INTO users (name, email, password, created_at)
      VALUES ('Smart User', 'user@parking.com', ?, ?)
    `, [defaultPassword, now]);

    console.log('Database initialized with default slots and tables.');
  });
}

// ESP8266 Heartbeat Tracker
let lastEspHeartbeat = null; // timestamp in milliseconds

function markEspActive() {
  lastEspHeartbeat = Date.now();
}

function checkEspOnline() {
  if (!lastEspHeartbeat) return false;
  // Consider online if heartbeat was within the last 15 seconds
  return (Date.now() - lastEspHeartbeat) < 15000;
}

// Status calculation logic based on vehicle presence and reservation
// Vehicle: No,  Reserved: No  -> AVAILABLE
// Vehicle: No,  Reserved: Yes -> RESERVED
// Vehicle: Yes, Reserved: No  -> OCCUPIED
// Vehicle: Yes, Reserved: Yes -> OCCUPIED
function computeStatus(vehicleDetected, reserved) {
  if (vehicleDetected) return 'occupied';
  if (reserved) return 'reserved';
  return 'available';
}

// -------------------------------------------------------------
// AUTHENTICATION ROUTES
// -------------------------------------------------------------

// POST /api/auth/register
app.post('/api/auth/register', (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ success: false, message: 'All fields (Name, Email, Password) are required.' });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const hashedPassword = hashPassword(password);
  const now = getISTDateTime();

  const insertSql = `INSERT INTO users (name, email, password, created_at) VALUES (?, ?, ?, ?)`;
  db.run(insertSql, [name.trim(), trimmedEmail, hashedPassword, now], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.status(409).json({ success: false, message: 'This email is already registered. Please log in.' });
      }
      return res.status(500).json({ success: false, message: 'Database error registering user.' });
    }

    const newUser = { id: this.lastID, name: name.trim(), email: trimmedEmail };
    const token = generateToken(newUser);
    return res.status(201).json({
      success: true,
      message: 'Registration successful! Welcome to Smart Parking.',
      user: newUser,
      token
    });
  });
});

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'Email and password are required.' });
  }

  const trimmedEmail = email.trim().toLowerCase();
  const hashedPassword = hashPassword(password);

  const query = `SELECT id, name, email, password FROM users WHERE email = ?`;
  db.get(query, [trimmedEmail], (err, row) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database error during login.' });
    }

    if (!row || row.password !== hashedPassword) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const user = { id: row.id, name: row.name, email: row.email };
    const token = generateToken(user);
    return res.json({
      success: true,
      message: 'Login successful!',
      user,
      token
    });
  });
});

// GET /api/auth/me
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ success: true, user: req.user });
});

// -------------------------------------------------------------
// ESP8266 & PARKING STATUS ROUTES
// -------------------------------------------------------------

// POST /api/parking/update (ESP8266 -> Server)
// ESP8266 sends: { "slot1": { "vehicleDetected": true }, "slot2": { "vehicleDetected": false } }
app.post('/api/parking/update', (req, res) => {
  markEspActive();
  const { slot1, slot2 } = req.body;

  if (!slot1 && !slot2) {
    return res.status(400).json({ success: false, message: 'No slot data provided in payload.' });
  }

  const now = getISTDateTime();

  // Helper promise to update a slot with actual vehicle detection
  function updateSlotSensor(slotNum, slotData) {
    return new Promise((resolve, reject) => {
      if (!slotData || typeof slotData.vehicleDetected === 'undefined') {
        return resolve();
      }

      const vehicleDetected = slotData.vehicleDetected ? 1 : 0;

      // First query current reservation state
      db.get(`SELECT reserved FROM slots WHERE slot_number = ?`, [slotNum], (err, row) => {
        if (err) return reject(err);

        const reserved = row ? row.reserved : 0;
        const newStatus = computeStatus(vehicleDetected === 1, reserved === 1);

        db.run(
          `UPDATE slots SET vehicle_detected = ?, status = ?, updated_at = ? WHERE slot_number = ?`,
          [vehicleDetected, newStatus, now, slotNum],
          (updateErr) => {
            if (updateErr) return reject(updateErr);
            resolve();
          }
        );
      });
    });
  }

  Promise.all([
    updateSlotSensor(1, slot1),
    updateSlotSensor(2, slot2)
  ])
    .then(() => {
      // Fetch latest slot status summary to return
      db.all(`SELECT * FROM slots ORDER BY slot_number ASC`, [], (err, rows) => {
        if (err) {
          return res.status(500).json({ success: false, message: 'Failed to retrieve slot summary.' });
        }

        const totalSlots = 2;
        let availableSlots = 0;
        let reservedSlots = 0;
        let occupiedSlots = 0;

        rows.forEach(s => {
          if (s.status === 'occupied') occupiedSlots++;
          else if (s.status === 'reserved') reservedSlots++;
          else availableSlots++;
        });

        res.json({
          success: true,
          message: 'Parking slots updated successfully',
          totalSlots,
          availableSlots,
          reservedSlots,
          occupiedSlots
        });
      });
    })
    .catch((err) => {
      console.error('Error updating slot data from ESP8266:', err);
      res.status(500).json({ success: false, message: 'Failed to update slots in database.' });
    });
});

// GET /api/parking/status (Server -> ESP8266 & Web Dashboard)
app.get('/api/parking/status', (req, res) => {
  // If caller query specifies esp8266 or User-Agent is ESP8266, mark heartbeat
  if (req.query.caller === 'esp8266' || (req.headers['user-agent'] && req.headers['user-agent'].includes('ESP8266'))) {
    markEspActive();
  }

  db.all(`SELECT * FROM slots ORDER BY slot_number ASC`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database query failed.' });
    }

    const totalSlots = 2;
    let availableSlots = 0;
    let reservedSlots = 0;
    let occupiedSlots = 0;

    const slotsObj = {};

    rows.forEach(slot => {
      const isReserved = slot.reserved === 1;
      const isVehicleDetected = slot.vehicle_detected === 1;
      const status = slot.status;

      if (status === 'occupied') occupiedSlots++;
      else if (status === 'reserved') reservedSlots++;
      else availableSlots++;

      // LED ON if occupied or reserved, OFF if available
      const ledStatus = (status === 'occupied' || status === 'reserved') ? 'ON' : 'OFF';

      slotsObj[`slot${slot.slot_number}`] = {
        slotNumber: slot.slot_number,
        status: status,
        reserved: isReserved,
        vehicleDetected: isVehicleDetected,
        ledStatus: ledStatus,
        updatedAt: slot.updated_at
      };
    });

    res.json({
      totalSlots,
      availableSlots,
      reservedSlots,
      occupiedSlots,
      espOnline: checkEspOnline(),
      lastEspSeen: lastEspHeartbeat 
        ? new Date(lastEspHeartbeat).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true }) 
        : null,
      slots: slotsObj
    });
  });
});

// -------------------------------------------------------------
// RESERVATION ROUTES
// -------------------------------------------------------------

// POST /api/parking/reserve
// Reserves an available slot
app.post('/api/parking/reserve', optionalAuthMiddleware, (req, res) => {
  const slotNum = parseInt(req.body.slot, 10);

  if (isNaN(slotNum) || (slotNum !== 1 && slotNum !== 2)) {
    return res.status(400).json({ success: false, message: 'Invalid slot number. Choose 1 or 2.' });
  }

  const userId = req.user ? req.user.id : 1; // Fallback to user 1 if not logged in
  const now = getISTDateTime();

  db.get(`SELECT * FROM slots WHERE slot_number = ?`, [slotNum], (err, slot) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database query failed.' });
    }

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }

    // Availability validation as requested:
    // If already occupied -> "Slot Occupied"
    if (slot.vehicle_detected === 1 || slot.status === 'occupied') {
      return res.status(400).json({ success: false, message: 'Slot Occupied' });
    }

    // If already reserved -> "Slot Already Reserved"
    if (slot.reserved === 1 || slot.status === 'reserved') {
      return res.status(400).json({ success: false, message: 'Slot Already Reserved' });
    }

    // Mark slot as reserved
    db.run(
      `UPDATE slots SET reserved = 1, status = 'reserved', updated_at = ? WHERE slot_number = ?`,
      [now, slotNum],
      (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ success: false, message: 'Failed to update slot reservation status.' });
        }

        // Insert reservation record into SQLite
        db.run(
          `INSERT INTO reservations (slot_number, user_id, status, reserved_at) VALUES (?, ?, 'active', ?)`,
          [slotNum, userId, now],
          function(insertErr) {
            if (insertErr) {
              console.error('Reservation table insert error:', insertErr);
            }

            return res.json({
              success: true,
              message: 'Reservation Successful',
              slot: slotNum,
              reservationId: this.lastID,
              reservedAt: now
            });
          }
        );
      }
    );
  });
});

// POST /api/parking/cancel
// Cancels a slot reservation
app.post('/api/parking/cancel', optionalAuthMiddleware, (req, res) => {
  const slotNum = parseInt(req.body.slot, 10);

  if (isNaN(slotNum) || (slotNum !== 1 && slotNum !== 2)) {
    return res.status(400).json({ success: false, message: 'Invalid slot number.' });
  }

  const now = getISTDateTime();

  db.get(`SELECT * FROM slots WHERE slot_number = ?`, [slotNum], (err, slot) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Database query error.' });
    }

    if (!slot) {
      return res.status(404).json({ success: false, message: 'Slot not found.' });
    }

    // If vehicle is physically present, status remains occupied; otherwise becomes available
    const newStatus = slot.vehicle_detected === 1 ? 'occupied' : 'available';

    // 1. Update slot
    db.run(
      `UPDATE slots SET reserved = 0, status = ?, updated_at = ? WHERE slot_number = ?`,
      [newStatus, now, slotNum],
      (updateErr) => {
        if (updateErr) {
          return res.status(500).json({ success: false, message: 'Failed to cancel reservation on slot.' });
        }

        // 2. Mark active reservation as cancelled
        db.run(
          `UPDATE reservations SET status = 'cancelled', cancelled_at = ? WHERE slot_number = ? AND status = 'active'`,
          [now, slotNum],
          (resErr) => {
            if (resErr) {
              console.error('Error updating reservation record:', resErr);
            }

            return res.json({
              success: true,
              message: `Reservation for Slot ${slotNum} cancelled successfully.`,
              slot: slotNum,
              newStatus
            });
          }
        );
      }
    );
  });
});

// -------------------------------------------------------------
// TAB 2 & TAB 3 MANAGEMENT ROUTES
// -------------------------------------------------------------

// GET /api/parking/slots (Tab 2: Parking Slot Management)
app.get('/api/parking/slots', (req, res) => {
  db.all(`SELECT * FROM slots ORDER BY slot_number ASC`, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch slots.' });
    }

    const formattedSlots = rows.map(s => {
      const isReserved = s.reserved === 1;
      const isVehicle = s.vehicle_detected === 1;
      const statusTitle = s.status.charAt(0).toUpperCase() + s.status.slice(1);
      const led = (s.status === 'occupied' || s.status === 'reserved') ? 'ON' : 'OFF';

      return {
        id: s.id,
        slotNumber: s.slot_number,
        slotName: `Slot ${s.slot_number}`,
        status: statusTitle,
        reserved: isReserved ? 'Yes' : 'No',
        vehicle: isVehicle ? 'Yes' : 'No',
        led: led,
        rawStatus: s.status,
        updatedAt: s.updated_at
      };
    });

    res.json({ success: true, slots: formattedSlots });
  });
});

// GET /api/parking/reservations (Tab 3: Reservation Management)
app.get('/api/parking/reservations', (req, res) => {
  const query = `
    SELECT 
      r.id,
      r.slot_number,
      r.status,
      r.reserved_at,
      r.cancelled_at,
      COALESCE(u.name, 'Guest User') AS user_name,
      COALESCE(u.email, 'N/A') AS user_email
    FROM reservations r
    LEFT JOIN users u ON r.user_id = u.id
    ORDER BY r.id DESC
  `;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ success: false, message: 'Failed to fetch reservations.' });
    }

    const reservations = rows.map((r, index) => {
      // Split IST date and time if available
      let dateStr = 'N/A';
      let timeStr = 'N/A';
      if (r.reserved_at) {
        const parts = r.reserved_at.split(', ');
        if (parts.length >= 2) {
          dateStr = parts[0];
          timeStr = parts[1];
        } else {
          dateStr = r.reserved_at;
        }
      }

      return {
        index: index + 1,
        id: r.id,
        slotNumber: r.slot_number,
        slotName: `Slot ${r.slot_number}`,
        userName: r.user_name,
        userEmail: r.user_email,
        status: r.status.toUpperCase(),
        rawStatus: r.status,
        date: dateStr,
        time: timeStr,
        fullTimestamp: r.reserved_at,
        cancelledAt: r.cancelled_at
      };
    });

    res.json({ success: true, reservations });
  });
});

// Root route redirect to index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server on 0.0.0.0 and PORT (Render Requirement)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`🚗 Smart Parking System Server Running`);
  console.log(`Port: ${PORT}`);
  console.log(`Local Access: http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Ready for Render Cloud Deployment`);
  console.log(`===============================================`);
});
