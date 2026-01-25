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

// Get single food
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

module.exports = router;
