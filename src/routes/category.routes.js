const express = require('express');
const router = express.Router();
const categoryController = require('../controllers/categoryController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Get all categories (all roles)
router.get('/', categoryController.getAll);

// Get single category with foods
router.get('/:id', categoryController.getById);

// Create category (admin only)
router.post('/', requireRole('admin'), categoryController.create);

// Update category (admin only)
router.put('/:id', requireRole('admin'), categoryController.update);
router.patch('/:id', requireRole('admin'), categoryController.update);

// Reorder categories (admin only)
router.post('/reorder', requireRole('admin'), categoryController.reorder);

// Delete category (admin only)
router.delete('/:id', requireRole('admin'), categoryController.delete);

// Restore category (admin only)
router.post('/:id/restore', requireRole('admin'), categoryController.restore);

module.exports = router;
