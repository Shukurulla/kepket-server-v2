const express = require('express');
const cors = require('cors');
const http = require('http');

// Load environment variables
const config = require('./config/env');
const connectDB = require('./config/database');
const socketService = require('./services/socketService');
const routes = require('./routes');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Initialize express app
const app = express();
const server = http.createServer(app);

// Connect to database
connectDB();

// Initialize socket.io
socketService.init(server);

// Middleware
app.use(cors({
  origin: config.CORS_ORIGIN,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logging (development)
if (config.ENABLE_REQUEST_LOGGING) {
  app.use((req, res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// API routes
app.use('/api', routes);

// 404 handler
app.use(notFound);

// Error handler
app.use(errorHandler);

// Start server
const PORT = config.PORT;

server.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🍽️  Restoran Backend v2.0                               ║
║                                                           ║
║   Server:     http://localhost:${PORT}                      ║
║   API:        http://localhost:${PORT}/api                  ║
║   Socket:     ws://localhost:${PORT}                        ║
║   Environment: ${config.NODE_ENV}                            ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
  // Don't exit in development
  if (config.NODE_ENV === 'production') {
    server.close(() => process.exit(1));
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  if (config.NODE_ENV === 'production') {
    process.exit(1);
  }
});

module.exports = { app, server };
