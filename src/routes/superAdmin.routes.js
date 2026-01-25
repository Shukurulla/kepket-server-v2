const express = require('express');
const router = express.Router();
const superAdminController = require('../controllers/superAdminController');

// Public routes
router.post('/setup', superAdminController.setup);
router.post('/login', superAdminController.login);

// Protected routes - require super admin auth
router.use(superAdminController.authMiddleware);

// Dashboard
router.get('/dashboard/stats', superAdminController.getDashboardStats);

// Restaurants
router.get('/restaurants', superAdminController.getRestaurants);
router.get('/restaurants/:id', superAdminController.getRestaurant);
router.post('/restaurants', superAdminController.createRestaurant);
router.put('/restaurants/:id', superAdminController.updateRestaurant);
router.delete('/restaurants/:id', superAdminController.deleteRestaurant);
router.patch('/restaurants/:id/subscription', superAdminController.updateSubscription);

// Staff
router.get('/staff', superAdminController.getStaff);
router.get('/staff/check-phone/:phone', superAdminController.checkPhone);

module.exports = router;
