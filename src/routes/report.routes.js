const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication and admin/cashier role
router.use(auth);
router.use(requireRole('admin', 'cashier'));

// Dashboard summary
router.get('/dashboard', reportController.getDashboard);

// Sales report
router.get('/sales', reportController.getSalesReport);

// Food performance
router.get('/foods', reportController.getFoodReport);

// Staff performance
router.get('/staff', reportController.getStaffReport);

// Payment methods breakdown
router.get('/payments', reportController.getPaymentReport);

// Hourly analysis
router.get('/hourly', reportController.getHourlyAnalysis);

// Category performance
router.get('/categories', reportController.getCategoryReport);

module.exports = router;
