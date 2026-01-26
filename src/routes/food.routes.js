const express = require('express');
const router = express.Router();
const foodController = require('../controllers/foodController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const upload = require('../middleware/upload');

// All routes require authentication
router.use(auth);

// Get menu (categories with foods) - for waiter app
router.get('/menu', foodController.getMenu);

// Get all foods
router.get('/', foodController.getAll);

// Get foods by category
router.get('/category/:categoryId', foodController.getByCategory);

// === TZ 1.3, 2.2: Stop-list routes (admin va cashier) ===
// MUHIM: Bu routelar /:id dan OLDIN bo'lishi kerak!
router.get('/stoplist/all', requireRole('admin', 'cashier'), foodController.getStopList);
router.post('/stoplist/bulk', requireRole('admin', 'cashier'), foodController.bulkAddToStopList);

// === Avto stop-list (kunlik limit) routes ===
// MUHIM: Bu routelar /:id dan OLDIN bo'lishi kerak!
router.get('/auto-stop/enabled', requireRole('admin'), foodController.getAutoStopEnabledFoods);
router.get('/auto-stop/near-limit', requireRole('admin', 'cashier'), foodController.getFoodsNearLimit);
router.post('/auto-stop/reset-daily', requireRole('admin'), foodController.resetDailyOrderCounts);
router.post('/auto-stop/bulk-settings', requireRole('admin'), foodController.bulkUpdateAutoStopSettings);

// Get single food (MUHIM: static routelardan KEYIN)
router.get('/:id', foodController.getById);

// Create food (admin only) - with image upload
router.post('/', requireRole('admin'), upload.single('image'), foodController.create);

// Bulk update availability (admin only)
router.post('/bulk-availability', requireRole('admin'), foodController.bulkUpdateAvailability);

// Reorder foods (admin only)
router.post('/reorder', requireRole('admin'), foodController.reorder);

// Update food (admin only) - with image upload
router.put('/:id', requireRole('admin'), upload.single('image'), foodController.update);
router.patch('/:id', requireRole('admin'), upload.single('image'), foodController.update);

// Toggle availability (admin, cashier)
router.post('/:id/toggle-availability', requireRole('admin', 'cashier'), foodController.toggleAvailability);

// Delete food (admin only)
router.delete('/:id', requireRole('admin'), foodController.delete);

// Restore food (admin only)
router.post('/:id/restore', requireRole('admin'), foodController.restore);

// Stop-list routes with :id param
router.post('/:id/stoplist/add', requireRole('admin', 'cashier'), foodController.addToStopList);
router.post('/:id/stoplist/remove', requireRole('admin', 'cashier'), foodController.removeFromStopList);

// Avto stop-list route with :id param
router.patch('/:id/auto-stop', requireRole('admin'), foodController.updateAutoStopSettings);

module.exports = router;
