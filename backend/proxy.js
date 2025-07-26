const httpProxy = require('http-proxy');
const http = require('http');

// Create a proxy server
const proxy = httpProxy.createProxyServer({});

// Handle proxy errors
proxy.on('error', function(err, req, res) {
  console.error('Proxy error:', err);
  res.writeHead(500, {
    'Content-Type': 'text/plain'
  });
  res.end('Proxy error: ' + err);
});

// Create an HTTP server
const server = http.createServer((req, res) => {
  console.log(`Received request: ${req.method} ${req.url}`);
  
  // Route API requests to the backend
  if (req.url.startsWith('/api')) {
    console.log(`→ Routing to backend: ${req.url}`);
    proxy.web(req, res, { 
      target: 'http://localhost:3000',
      changeOrigin: true
    });
  } 
  // Route all other requests to the frontend
  else {
    console.log(`→ Routing to frontend: ${req.url}`);
    proxy.web(req, res, { 
      target: 'http://localhost:5000',
      changeOrigin: true
    });
  }
});

const PORT = 8000;
console.log('┌──────────────────────────────────────────┐');
console.log('│ Proxy server started on port 8000        │');
console.log('│ Routing /api/* to http://localhost:3000  │');
console.log('│ Routing all other to http://localhost:5000 │');
console.log('└──────────────────────────────────────────┘');
console.log(`Current Date and Time (UTC - YYYY-MM-DD HH:MM:SS formatted): ${new Date().toISOString().replace('T', ' ').slice(0, 19)}`);
console.log('Current User\'s Login: Azonix07');
server.listen(PORT);