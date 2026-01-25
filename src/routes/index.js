const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const orderRoutes = require('./order.routes');

// API routes
router.use('/auth', authRoutes);
router.use('/orders', orderRoutes);

// Health check
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// API info
router.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Restoran API v2.0',
    version: '2.0.0',
    endpoints: {
      auth: '/api/auth',
      orders: '/api/orders',
      staff: '/api/staff',
      categories: '/api/categories',
      foods: '/api/foods',
      tables: '/api/tables',
      kitchen: '/api/kitchen',
      reports: '/api/reports'
    }
  });
});

// Legacy routes for backward compatibility
// These will be removed in future versions

// Staff login (legacy)
router.post('/staff/login', (req, res, next) => {
  console.warn('DEPRECATED: Use /api/auth/login instead');
  req.url = '/auth/login';
  authRoutes(req, res, next);
});

// Kitchen orders (legacy)
router.get('/kitchen-orders', (req, res) => {
  console.warn('DEPRECATED: Use /api/kitchen/orders instead');
  res.redirect(307, '/api/orders?status=preparing');
});

// Orders today (legacy)
router.get('/orders/today', (req, res) => {
  console.warn('DEPRECATED: Use /api/orders/today instead');
  res.redirect(307, '/api/orders/today');
});

module.exports = router;
