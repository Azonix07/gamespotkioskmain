const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Restore `console.log` if overridden
console.log = console.log || ((...args) => process.stdout.write(args.join(' ') + '\n'));

const app = express();
const PORT = process.env.PORT || 3000;
const dbPath = path.resolve(__dirname, 'gamespot.db');

console.log(`Using database at path: ${dbPath}`);

// Global error handlers
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message, err.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
});

// Check if database exists, if not create it
const dbExists = fs.existsSync(dbPath);
console.log(`Database exists at ${dbPath}: ${dbExists}`);

// Initialize database connection with more robust error handling
console.log(`Attempting to connect to database at: ${dbPath}`);
let db;
try {
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error(`Database connection error: ${err.message}`);
    } else {
      console.log('Connected to the SQLite database.');
      // Initialize the database schema
      initializeDatabase();
    }
  });
} catch (error) {
  console.error(`Failed to create database connection: ${error.message}`);
  db = new sqlite3.Database(':memory:'); // Fallback to memory database
  initializeDatabase();
}

// Initialize the database with tables including payments with photo_data column
function initializeDatabase() {
  console.log("Initializing database...");
  
  // First, ensure the ps5_consoles table exists
  db.run(`CREATE TABLE IF NOT EXISTS ps5_consoles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE,
    booked INTEGER DEFAULT 0,
    end_time INTEGER
  )`, function(err) {
    if (err) {
      return console.error("Error creating ps5_consoles table:", err.message);
    }
    console.log("ps5_consoles table ready.");
    
    // Check if table has any records
    db.get('SELECT COUNT(*) as count FROM ps5_consoles', [], function(err, row) {
      if (err) {
        return console.error("Error checking ps5_consoles count:", err.message);
      }
      
      // Add default consoles if none exist
      if (row && row.count === 0) {
        console.log("Adding default PS5 consoles...");
        const defaultConsoles = ['PS5 #1', 'PS5 #2', 'PS5 #3', 'PS5 #4', 'Logitech G920'];
        defaultConsoles.forEach(name => {
          db.run('INSERT INTO ps5_consoles (name, booked) VALUES (?, 0)', [name], function(err) {
            if (err) console.error(`Error adding console ${name}:`, err.message);
          });
        });
      }
    });
  });

  // Check if payments table exists and has photo_data column
  db.get("SELECT sql FROM sqlite_master WHERE type='table' AND name='payments'", [], function(err, row) {
    if (err) {
      console.error("Error checking payments table:", err.message);
      return;
    }
    
    if (row) {
      console.log("Found existing payments table");
      
      // Check if photo_data column exists by querying the table structure
      const tableDefinition = row.sql;
      console.log("Table definition:", tableDefinition);
      
      if (tableDefinition && !tableDefinition.toLowerCase().includes('photo_data')) {
        console.log("The payments table exists but doesn't have the photo_data column. Backing up and recreating...");
        
        // Back up existing data
        db.all("SELECT id, console, minutes, method, user, paid_at FROM payments", [], function(err, rows) {
          if (err) {
            console.error("Error backing up payments data:", err.message);
            return;
          }
          
          console.log(`Backed up ${rows.length} payment records`);
          
          // Drop the existing table
          db.run("DROP TABLE payments", function(err) {
            if (err) {
              console.error("Error dropping payments table:", err.message);
              return;
            }
            
            console.log("Old payments table dropped successfully");
            
            // Create new table with photo_data column
            createPaymentsTable(function() {
              // Restore backed up data
              if (rows.length > 0) {
                console.log("Restoring payment data...");
                
                rows.forEach(row => {
                  db.run(
                    "INSERT INTO payments (id, console, minutes, method, user, paid_at) VALUES (?, ?, ?, ?, ?, ?)",
                    [row.id, row.console, row.minutes, row.method, row.user, row.paid_at],
                    function(err) {
                      if (err) console.error("Error restoring payment data:", err.message);
                    }
                  );
                });
              }
            });
          });
        });
      } else {
        console.log("Payments table already includes photo_data column");
      }
    } else {
      console.log("Payments table doesn't exist, creating it...");
      createPaymentsTable();
    }
  });
}

// Create payments table with photo_data column
function createPaymentsTable(callback) {
  db.run(`CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    console TEXT,
    minutes INTEGER,
    method TEXT,
    user TEXT DEFAULT 'Azonix07',
    paid_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    photo_data TEXT
  )`, function(err) {
    if (err) {
      console.error("Error creating payments table:", err.message);
      return;
    }
    
    console.log("Created new payments table with photo_data column");
    
    if (callback) callback();
  });
}

// Helper function to ensure base64 data is properly formatted as a data URL
function ensureDataUrlFormat(photoData) {
  if (!photoData) return null;
  
  try {
    // If it's already a valid data URL, return it as is
    if (typeof photoData === 'string' && photoData.startsWith('data:image')) {
      return photoData;
    }
    
    // Otherwise, assume it's a raw base64 string and add the prefix
    return `data:image/jpeg;base64,${photoData}`;
  } catch (err) {
    console.error("Error formatting photo data:", err);
    return null;
  }
}

// Configure CORS to allow local development connections
app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080',
    'http://192.168.1.100:3000',
    'http://192.168.1.100:8080',
    'http://localhost:5500',
    'http://127.0.0.1:5500'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Increase JSON size limit for base64 encoded images
app.use(express.json({ limit: '20mb' }));

// Add health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mode: 'local development'
  });
});

// Log all API requests
app.use('/api', (req, res, next) => {
  console.log(`API Request: ${req.method} ${req.url}`);
  next();
});

// Endpoint to get the status of consoles
app.get('/api/status', (req, res) => {
  db.all(
    'SELECT DISTINCT name, booked, end_time FROM ps5_consoles',
    [],
    (err, rows) => {
      if (err) {
        console.error("Error fetching console status:", err.message);
        return res.status(500).json({ error: 'Failed to fetch console status' });
      }
      const consoles = rows.map((row) => {
        const remainingTime =
          row.booked && row.end_time ? Math.max(0, row.end_time - Date.now()) : null;
        return { name: row.name, booked: row.booked, remainingTime };
      });
      res.json(consoles);
    }
  );
});

// Endpoint to book a console
app.post('/api/book', (req, res) => {
  const { console, minutes } = req.body;

  // Validate request data
  if (!console || !minutes || minutes <= 0) {
    console.warn("Invalid booking data:", req.body);
    return res.status(400).json({ error: 'Invalid booking data' });
  }

  const endTime = Date.now() + minutes * 60 * 1000; // Calculate end time in milliseconds

  db.run(
    'UPDATE ps5_consoles SET booked = 1, end_time = ? WHERE name = ? AND booked = 0',
    [endTime, console],
    function (err) {
      if (err) {
        console.error("Database error during booking:", err.message);
        return res.status(500).json({ error: 'Database error occurred' });
      }

      if (this.changes === 0) {
        console.warn(`Console "${console}" is already booked.`);
        return res.status(400).json({ error: 'Console is already booked' });
      }

      console.log(`Console "${console}" booked successfully until ${new Date(endTime).toISOString()}`);
      res.json({ success: true, console, endTime });
    }
  );
});

// Enhanced payment endpoint that stores photo as Base64
app.post('/api/pay', (req, res) => {
  const { console, minutes, method, photoData } = req.body;
  
  console.log('Payment request received:', { 
    console, 
    minutes, 
    method, 
    hasPhoto: !!photoData, 
    photoDataLength: photoData ? photoData.length : 0 
  });
  
  // Convert minutes to a number if it's a string
  const minutesNumber = parseInt(minutes, 10);
  
  // Validate request data with better error messages
  if (!console) {
    console.warn("Missing console in payment data:", req.body);
    return res.status(400).json({ error: 'Missing console name' });
  }
  
  if (!minutes || isNaN(minutesNumber) || minutesNumber <= 0) {
    console.warn("Invalid minutes in payment data:", req.body);
    return res.status(400).json({ error: 'Invalid minutes value' });
  }
  
  if (!method) {
    console.warn("Missing payment method:", req.body);
    return res.status(400).json({ error: 'Missing payment method' });
  }
  
  // Make sure photoData is properly formatted before storing
  let formattedPhotoData = null;
  if (photoData) {
    formattedPhotoData = ensureDataUrlFormat(photoData);
    console.log("Photo data formatted:", formattedPhotoData ? "Success" : "Failed");
  }
  
  // Process payment with the properly formatted photoData
  processPayment(console, minutesNumber, method, formattedPhotoData, res);
});

// Simplified payment processing function
function processPayment(console, minutes, method, photoData, res) {
  // Use a try-catch to handle any unexpected errors
  try {
    const sql = 'INSERT INTO payments (console, minutes, method, user, photo_data) VALUES (?, ?, ?, ?, ?)';
    const params = [console, minutes, method, 'Azonix07', photoData];
    
    // Log the query and data
    console.log(`Running SQL: ${sql} with params: [console=${console}, minutes=${minutes}, method=${method}, user=Azonix07, photo_data=${photoData ? '(photo data present)' : 'null'}]`);
    
    // Insert payment record
    db.run(sql, params, function(err) {
      if (err) {
        console.error("Database error during payment:", err.message);
        return res.status(500).json({ error: `Database error: ${err.message}` });
      }
      
      console.log(`Payment processed successfully: ID=${this.lastID}, console="${console}", minutes=${minutes}, method="${method}"`);
      
      // Book the console
      const endTime = Date.now() + minutes * 60 * 1000;
      
      db.run(
        'UPDATE ps5_consoles SET booked = 1, end_time = ? WHERE name = ?',
        [endTime, console],
        function(err) {
          if (err) {
            console.error("Error updating console status after payment:", err.message);
            // Payment was successful even if booking fails
          } else {
            console.log(`Console "${console}" marked as booked until ${new Date(endTime).toISOString()}`);
          }
          
          // Mock ESP32 power command instead of actually sending it
          if (console.includes('PS5')) {
            console.log(`[TEST MODE] Would send Power ON command to ${console} if ESP32 was connected`);
          }
          
          // Return success
          res.json({ 
            success: true,
            message: "Payment processed successfully",
            paymentId: this.lastID,
            timestamp: new Date().toISOString(),
            photoSaved: photoData ? true : false,
            powerOn: console.includes('PS5') ? true : false, // Simulate successful power on
            testMode: true // Indicate we're in test mode
          });
        }
      );
    });
  } catch (error) {
    console.error("Unexpected error in processPayment:", error);
    return res.status(500).json({ error: 'An unexpected error occurred processing the payment' });
  }
}

// ESP32 Power Control API - TEST MODE VERSION
app.post('/api/power-control', (req, res) => {
  const { console, action } = req.body;
  
  if (!console || !['on', 'off'].includes(action)) {
    return res.status(400).json({ error: 'Invalid request. Required: console name and action (on/off)' });
  }
  
  // Mock successful response instead of actually sending commands
  console.log(`[TEST MODE] Would send ${action} command to ${console} if ESP32 was connected`);
  
  // Simulate a brief delay
  setTimeout(() => {
    res.json({ 
      success: true, 
      message: `${console} power ${action} command simulated successfully`, 
      testMode: true
    });
  }, 500);
});

// Safe payments endpoint with fallback if column doesn't exist
app.get('/api/payments', (req, res) => {
  // First check if photo_data column exists before querying
  db.all("PRAGMA table_info(payments)", [], function(err, columns) {
    if (err) {
      console.error("Error checking table info:", err.message);
      return res.status(500).json({ error: 'Failed to check payments table schema' });
    }
    
    // Check if photo_data column exists in the columns array
    const hasPhotoData = columns.some(col => col.name === 'photo_data');
    console.log("Payments table has photo_data column:", hasPhotoData);
    
    let query;
    if (hasPhotoData) {
      query = 'SELECT id, console, minutes, method, user, paid_at, photo_data FROM payments ORDER BY paid_at DESC';
    } else {
      query = 'SELECT id, console, minutes, method, user, paid_at FROM payments ORDER BY paid_at DESC';
    }
    
    // Now we can safely execute the query
    db.all(query, [], (err, rows) => {
      if (err) {
        console.error("Error fetching payments:", err.message);
        return res.status(500).json({ error: 'Failed to fetch payment history' });
      }
      
      console.log(`Retrieved ${rows.length} payment records`);
      
      const payments = rows.map(row => {
        // Format the photo data if it exists and we have the column
        const formattedPhotoData = hasPhotoData && row.photo_data ? ensureDataUrlFormat(row.photo_data) : null;
        
        return {
          ...row,
          // Return both photoUrl and photoData for compatibility
          photoUrl: formattedPhotoData,
          photoData: formattedPhotoData
        };
      });
      
      res.json(payments);
    });
  });
});

// Endpoint to get system info
app.get('/api/info', (req, res) => {
  // Updated timestamp
  const currentDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  const currentUser = 'Azonix07';
  
  res.json({
    date: currentDate,
    user: currentUser,
    server: {
      uptime: process.uptime(),
      nodeVersion: process.version,
      mode: 'Local Development',
      esp32Status: 'Test Mode'
    }
  });
});

// Debug endpoint to check database tables and schema
app.get('/api/debug/tables', (req, res) => {
  db.all("SELECT name FROM sqlite_master WHERE type='table'", [], (err, tables) => {
    if (err) return res.status(500).json({ error: err.message });
    
    const tableData = {};
    let completedTables = 0;
    
    if (tables.length === 0) {
      return res.json({ tables: [] });
    }
    
    tables.forEach(table => {
      db.all(`PRAGMA table_info(${table.name})`, [], (err, columns) => {
        if (err) {
          tableData[table.name] = { error: err.message };
        } else {
          tableData[table.name] = { columns };
        }
        
        completedTables++;
        if (completedTables === tables.length) {
          res.json({ 
            tables: tables.map(t => t.name),
            schema: tableData,
            dbPath: dbPath,
            dbExists: fs.existsSync(dbPath)
          });
        }
      });
    });
  });
});

// Reset endpoint to clear all bookings (for admin use)
app.post('/api/reset', (req, res) => {
  try {
    // Reset all bookings in database
    db.run('UPDATE ps5_consoles SET booked = 0, end_time = NULL', function(err) {
      if (err) {
        console.error("Error resetting console bookings:", err.message);
        return res.status(500).json({ error: 'Failed to reset bookings' });
      }
      
      console.log(`All console bookings reset by Azonix07 at ${new Date().toISOString()}`);
      
      // Log simulated ESP32 commands
      console.log('[TEST MODE] Would send Power OFF commands to all PS5 consoles if ESP32 was connected');
      
      res.json({ 
        success: true, 
        message: 'All bookings have been reset (ESP32 commands simulated)',
        testMode: true 
      });
    });
  } catch (error) {
    console.error("Unexpected error in /api/reset:", error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// Endpoint to reset a single console
app.post('/api/reset-single', (req, res) => {
  try {
    const { console: consoleName } = req.body;
    
    if (!consoleName) {
      return res.status(400).json({ error: 'Missing console name' });
    }
    
    // Update the specific console's booking status
    db.run(
      'UPDATE ps5_consoles SET booked = 0, end_time = NULL WHERE name = ?',
      [consoleName],
      function(err) {
        if (err) {
          console.error("Error resetting console booking:", err.message);
          return res.status(500).json({ error: 'Failed to reset booking' });
        }
        
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Console not found' });
        }
        
        console.log(`Console ${consoleName} booking reset by Azonix07 at ${new Date().toISOString()}`);
        
        // Log simulated ESP32 command
        if (consoleName.includes('PS5')) {
          console.log(`[TEST MODE] Would send Power OFF command to ${consoleName} if ESP32 was connected`);
        }
        
        res.json({ 
          success: true, 
          message: `Booking for ${consoleName} has been reset (ESP32 command simulated)`,
          testMode: true
        });
      }
    );
  } catch (error) {
    console.error("Unexpected error in /api/reset-single:", error);
    res.status(500).json({ error: 'An unexpected error occurred' });
  }
});

// ESP32 status check endpoint - TEST MODE VERSION
app.get('/api/esp32-status', (req, res) => {
  // Simulated ESP32 controllers
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

// Start the server on localhost
app.listen(PORT, '0.0.0.0', () => {
  // Updated timestamp
  const currentDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`Current Date and Time (UTC - YYYY-MM-DD HH:MM:SS formatted): ${currentDate}`);
  console.log(`Current User's Login: Azonix07`);
  console.log(`🚀 Backend API server running on port ${PORT}`);
  console.log(`API endpoints available at http://localhost:${PORT}/api`);
  console.log(`🧪 ESP32 integration running in TEST MODE (no actual ESP32 connections will be made)`);
  console.log(`💻 Server configured for local development only`);
});