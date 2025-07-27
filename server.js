const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

// Create Express app
const app = express();
const PORT = process.env.PORT || 8080;

// Configure CORS for all origins in development
app.use(cors());

// Increase JSON size limit for base64 encoded images
app.use(express.json({ limit: '20mb' }));

// Simple health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'GameSpot Kiosk is running'
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend')));

// Create data directory
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Setup better-sqlite3
let db;
try {
  // Install better-sqlite3 with this command in terminal:
  // npm install better-sqlite3
  const Database = require('better-sqlite3');
  const dbPath = path.join(dataDir, 'gamespot.db');
  
  console.log(`Using database at: ${dbPath}`);
  db = new Database(dbPath, { verbose: console.log });
  
  // Initialize database schema
  initializeDatabase(db);
  console.log('Database initialized successfully');
} catch (err) {
  console.error('Failed to initialize database:', err);
}

// Initialize the database schema
function initializeDatabase(db) {
  // Create ps5_consoles table
  db.exec(`
    CREATE TABLE IF NOT EXISTS ps5_consoles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      booked INTEGER DEFAULT 0,
      end_time INTEGER
    )
  `);
  
  // Create payments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      console TEXT,
      minutes INTEGER,
      method TEXT,
      user TEXT DEFAULT 'Azonix07',
      paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      photo_data TEXT
    )
  `);
  
  // Check if consoles exist
  const count = db.prepare('SELECT COUNT(*) as count FROM ps5_consoles').get();
  
  // Add default consoles if none exist
  if (count.count === 0) {
    console.log("Adding default PS5 consoles...");
    const insert = db.prepare('INSERT INTO ps5_consoles (name, booked) VALUES (?, 0)');
    
    const defaultConsoles = ['PS5 #1', 'PS5 #2', 'PS5 #3', 'PS5 #4', 'Logitech G920'];
    for (const name of defaultConsoles) {
      insert.run(name);
    }
  }
}

// Helper function to ensure base64 data is properly formatted
function ensureDataUrlFormat(photoData) {
  if (!photoData) return null;
  
  try {
    if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
      return photoData;
    }
    return `data:image/jpeg;base64,${photoData}`;
  } catch (err) {
    console.error("Error formatting photo data:", err);
    return null;
  }
}

// API Routes
// Get console status
app.get('/api/status', (req, res) => {
  try {
    const rows = db.prepare('SELECT DISTINCT name, booked, end_time FROM ps5_consoles').all();
    const consoles = rows.map((row) => {
      const remainingTime =
        row.booked && row.end_time ? Math.max(0, row.end_time - Date.now()) : null;
      return { name: row.name, booked: row.booked, remainingTime };
    });
    res.json(consoles);
  } catch (err) {
    console.error("Error fetching console status:", err);
    res.status(500).json({ error: 'Failed to fetch console status' });
  }
});

// Book a console
app.post('/api/book', (req, res) => {
  const { console: consoleName, minutes } = req.body;

  if (!consoleName || !minutes || minutes <= 0) {
    return res.status(400).json({ error: 'Invalid booking data' });
  }

  const endTime = Date.now() + minutes * 60 * 1000;

  try {
    const result = db.prepare(
      'UPDATE ps5_consoles SET booked = 1, end_time = ? WHERE name = ? AND booked = 0'
    ).run(endTime, consoleName);
    
    if (result.changes === 0) {
      return res.status(400).json({ error: 'Console is already booked' });
    }
    
    res.json({ success: true, console: consoleName, endTime });
  } catch (err) {
    console.error("Database error during booking:", err);
    res.status(500).json({ error: 'Database error occurred' });
  }
});

// Process payment
app.post('/api/pay', (req, res) => {
  const { console: consoleName, minutes, method, photoData } = req.body;
  
  if (!consoleName) {
    return res.status(400).json({ error: 'Missing console name' });
  }
  
  if (!minutes || isNaN(parseInt(minutes)) || parseInt(minutes) <= 0) {
    return res.status(400).json({ error: 'Invalid minutes value' });
  }
  
  if (!method) {
    return res.status(400).json({ error: 'Missing payment method' });
  }
  
  const minutesNumber = parseInt(minutes);
  const formattedPhotoData = photoData ? ensureDataUrlFormat(photoData) : null;
  
  try {
    // Insert payment record
    const paymentResult = db.prepare(
      'INSERT INTO payments (console, minutes, method, user, photo_data) VALUES (?, ?, ?, ?, ?)'
    ).run(consoleName, minutesNumber, method, 'Azonix07', formattedPhotoData);
    
    const paymentId = paymentResult.lastInsertRowid;
    
    // Book the console
    const endTime = Date.now() + minutesNumber * 60 * 1000;
    db.prepare(
      'UPDATE ps5_consoles SET booked = 1, end_time = ? WHERE name = ?'
    ).run(endTime, consoleName);
    
    res.json({ 
      success: true,
      message: "Payment processed successfully",
      paymentId: paymentId,
      timestamp: new Date().toISOString(),
      photoSaved: !!formattedPhotoData,
      powerOn: consoleName.includes('PS5'),
      testMode: true
    });
  } catch (err) {
    console.error("Error processing payment:", err);
    res.status(500).json({ error: 'An error occurred processing the payment' });
  }
});

// Get payment history
app.get('/api/payments', (req, res) => {
  try {
    const payments = db.prepare(
      'SELECT id, console, minutes, method, user, paid_at, photo_data FROM payments ORDER BY paid_at DESC'
    ).all();
    
    const formattedPayments = payments.map(row => {
      const formattedPhotoData = row.photo_data ? ensureDataUrlFormat(row.photo_data) : null;
      return {
        ...row,
        photoUrl: formattedPhotoData,
        photoData: formattedPhotoData
      };
    });
    
    res.json(formattedPayments);
  } catch (err) {
    console.error("Error fetching payments:", err);
    res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

// System info
app.get('/api/info', (req, res) => {
  const currentDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  res.json({
    date: currentDate,
    user: 'Azonix07',
    server: {
      uptime: process.uptime(),
      nodeVersion: process.version,
      mode: 'Railway Deployment',
      esp32Status: 'Test Mode'
    }
  });
});

// Power control - Test mode
app.post('/api/power-control', (req, res) => {
  const { console, action } = req.body;
  
  if (!console || !['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'Invalid request' });
  }
  
  setTimeout(() => {
    res.json({ 
      success: true, 
      message: `${console} power ${action} command simulated successfully`, 
      testMode: true
    });
  }, 500);
});

// Reset all bookings
app.post('/api/reset', (req, res) => {
  try {
    db.prepare('UPDATE ps5_consoles SET booked = 0, end_time = NULL').run();
    res.json({ 
      success: true, 
      message: 'All bookings have been reset (ESP32 commands simulated)',
      testMode: true 
    });
  } catch (err) {
    console.error("Error resetting bookings:", err);
    res.status(500).json({ error: 'An error occurred' });
  }
});

// Reset single console
app.post('/api/reset-single', (req, res) => {
  const { console: consoleName } = req.body;
  
  if (!consoleName) {
    return res.status(400).json({ error: 'Missing console name' });
  }
  
  try {
    const result = db.prepare(
      'UPDATE ps5_consoles SET booked = 0, end_time = NULL WHERE name = ?'
    ).run(consoleName);
    
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Console not found' });
    }
    
    res.json({ 
      success: true, 
      message: `Booking for ${consoleName} has been reset (ESP32 command simulated)`,
      testMode: true
    });
  } catch (err) {
    console.error("Error resetting console:", err);
    res.status(500).json({ error: 'An error occurred' });
  }
});

// ESP32 status - Test mode
app.get('/api/esp32-status', (req, res) => {
  const mockControllers = [
    { console: 'PS5 #1', ip: '192.168.1.101', status: 'offline', error: 'Test Mode' },
    { console: 'PS5 #2', ip: '192.168.1.102', status: 'offline', error: 'Test Mode' },
    { console: 'PS5 #3', ip: '192.168.1.103', status: 'offline', error: 'Test Mode' },
    { console: 'PS5 #4', ip: '192.168.1.104', status: 'offline', error: 'Test Mode' }
  ];
  
  res.json({
    timestamp: new Date().toISOString(),
    controllers: mockControllers,
    testMode: true
  });
});

// Debug tables endpoint
app.get('/api/debug/tables', (req, res) => {
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    
    const tableData = {};
    for (const table of tables) {
      const columns = db.prepare(`PRAGMA table_info(${table.name})`).all();
      tableData[table.name] = { columns };
    }
    
    res.json({ 
      tables: tables.map(t => t.name),
      schema: tableData,
      dbPath: path.join(dataDir, 'gamespot.db'),
      dbExists: fs.existsSync(path.join(dataDir, 'gamespot.db'))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catch-all route to serve frontend for any unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/index.html'));
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  const currentDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`Current Date and Time (UTC - YYYY-MM-DD HH:MM:SS formatted): ${currentDate}`);
  console.log(`Current User's Login: Azonix07`);
  console.log(`🚀 Server running on port ${PORT}`);
});
