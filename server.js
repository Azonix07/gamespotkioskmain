const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const { execSync } = require('child_process');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS
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

// Create data directory for SQLite
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  console.log(`Creating data directory at ${DATA_DIR}`);
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Set environment variable for database path
process.env.DB_PATH = path.join(DATA_DIR, 'gamespot.db');
console.log(`Database will be stored at: ${process.env.DB_PATH}`);

// Add check to verify sqlite3 is working
let sqlite3Status = "Not checked";
try {
  execSync('node -e "require(\'sqlite3\')"', { cwd: './backend' });
  sqlite3Status = "Working correctly";
} catch (error) {
  sqlite3Status = `Error: ${error.message}`;
}

// Add diagnostic endpoint
app.get('/api/diagnostics', (req, res) => {
  res.json({
    dataDir: DATA_DIR,
    dbPath: process.env.DB_PATH,
    dbExists: fs.existsSync(process.env.DB_PATH),
    sqlite3Status,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend')));

// Setup backend routes
let backendInitialized = false;
try {
  // First, make sure SQLite3 is working
  require('./backend/node_modules/sqlite3');
  console.log('SQLite3 module loaded successfully');
  
  // Then load the backend
  const backend = require('./backend/index');
  if (backend) {
    console.log('Backend loaded successfully');
    backendInitialized = true;
  }
} catch (error) {
  console.error('Failed to initialize backend:', error);
}

// Status check endpoint
app.get('/api/status-check', (req, res) => {
  res.json({ 
    backendInitialized, 
    timestamp: new Date().toISOString()
  });
});

// Catch-all route to serve frontend
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
