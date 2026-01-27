const express = require('express');
const router = express.Router();
const tableCategoryController = require('../controllers/tableCategoryController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Get all table categories (all roles)
router.get('/', tableCategoryController.getAll);

// Get single category with tables
router.get('/:id', tableCategoryController.getById);

// Create table category (admin only)
router.post('/', requireRole('admin'), tableCategoryController.create);

// Update table category (admin only)
router.put('/:id', requireRole('admin'), tableCategoryController.update);
router.patch('/:id', requireRole('admin'), tableCategoryController.update);

// Reorder table categories (admin only)
router.post('/reorder', requireRole('admin'), tableCategoryController.reorder);

// Add tables to category (admin only)
router.post('/:id/tables', requireRole('admin'), tableCategoryController.addTables);

// Remove table from category (admin only)
router.delete('/:id/tables/:tableId', requireRole('admin'), tableCategoryController.removeTable);

// Delete table category (admin only)
router.delete('/:id', requireRole('admin'), tableCategoryController.delete);

// Restore table category (admin only)
router.post('/:id/restore', requireRole('admin'), tableCategoryController.restore);

module.exports = router;
