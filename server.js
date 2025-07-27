const express = require('express');
const path = require('path');
const cors = require('cors');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS
app.use(cors());

// Increase JSON size limit for base64 encoded images
app.use(express.json({ limit: '20mb' }));

// IMPORTANT: Add simple healthcheck endpoint first
// This ensures Railway can verify your app is running
app.get('/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'GameSpot Kiosk is running'
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'frontend')));

// Import the backend app
let backendInitialized = false;
try {
  // Don't let backend initialization block the healthcheck endpoint
  setTimeout(() => {
    try {
      // Load the backend with a delay to ensure healthcheck works first
      require('./backend/index.js');
      backendInitialized = true;
      console.log('Backend successfully initialized');
    } catch (error) {
      console.error('Failed to initialize backend:', error);
    }
  }, 2000);
} catch (error) {
  console.error('Error setting up backend initialization:', error);
}

// Add endpoint to check backend status
app.get('/api/status-check', (req, res) => {
  res.json({ 
    backendInitialized, 
    timestamp: new Date().toISOString()
  });
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
