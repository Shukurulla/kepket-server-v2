const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const orderRoutes = require('./order.routes');
const staffRoutes = require('./staff.routes');
const categoryRoutes = require('./category.routes');
const foodRoutes = require('./food.routes');
const tableRoutes = require('./table.routes');
const kitchenRoutes = require('./kitchen.routes');
const notificationRoutes = require('./notification.routes');
const reportRoutes = require('./report.routes');
const qrRoutes = require('./qr.routes');
const superAdminRoutes = require('./superAdmin.routes');

// API routes
router.use('/auth', authRoutes);
router.use('/orders', orderRoutes);
router.use('/staff', staffRoutes);
router.use('/categories', categoryRoutes);
router.use('/foods', foodRoutes);
router.use('/tables', tableRoutes);
router.use('/kitchen', kitchenRoutes);
router.use('/notifications', notificationRoutes);
router.use('/reports', reportRoutes);
router.use('/qr', qrRoutes);
router.use('/super-admin', superAdminRoutes);

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
      notifications: '/api/notifications',
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
  res.redirect(307, '/api/kitchen/orders');
});

// Orders today (legacy)
router.get('/orders/today', (req, res) => {
  console.warn('DEPRECATED: Use /api/orders?period=today instead');
  res.redirect(307, '/api/orders?period=today');
});

// Waiters list (legacy)
router.get('/waiters', (req, res) => {
  console.warn('DEPRECATED: Use /api/staff/waiters instead');
  res.redirect(307, '/api/staff/waiters');
});

// Menu (legacy)
router.get('/menu', (req, res) => {
  console.warn('DEPRECATED: Use /api/foods/menu instead');
  res.redirect(307, '/api/foods/menu');
});

module.exports = router;
