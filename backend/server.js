const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Set up database path - use environment variable for Railway
const dbPath = process.env.NODE_ENV === 'production' 
  ? path.resolve(__dirname, 'gamespot.db') 
  : path.resolve(__dirname, 'gamespot.db');

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

// Initialize database connection
let db;
try {
  db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
      console.error(`Database connection error: ${err.message}`);
    } else {
      console.log('Connected to the SQLite database.');
      initializeDatabase();
    }
  });
} catch (error) {
  console.error(`Failed to create database connection: ${error.message}`);
  db = new sqlite3.Database(':memory:'); // Fallback to memory database
  initializeDatabase();
}

// Import your existing initialization function
function initializeDatabase() {
  // Your existing initializeDatabase function
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

// Configure CORS to allow Railway and local development
app.use(cors({
  origin: [
    process.env.RAILWAY_STATIC_URL, // Railway domain
    'http://localhost:3000',
    'http://localhost:8080',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:8080'
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Increase JSON size limit for base64 encoded images
app.use(express.json({ limit: '20mb' }));

// Serve static frontend files - THIS IS THE IMPORTANT CHANGE
app.use(express.static(path.join(__dirname, '../frontend')));

// Add health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development'
  });
});

// Log all API requests
app.use('/api', (req, res, next) => {
  console.log(`API Request: ${req.method} ${req.url}`);
  next();
});

// Import your existing API routes here
// For example:
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

// Include all your other routes from index.js here
// ... 

// Catch-all route to serve frontend for any unmatched routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  const currentDate = new Date().toISOString().replace('T', ' ').substring(0, 19);
  console.log(`Current Date and Time (UTC - YYYY-MM-DD HH:MM:SS formatted): ${currentDate}`);
  console.log(`Current User's Login: Azonix07`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`Frontend serving from: ${path.join(__dirname, '../frontend')}`);
});
