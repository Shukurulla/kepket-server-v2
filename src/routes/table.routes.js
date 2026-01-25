const express = require('express');
const router = express.Router();
const tableController = require('../controllers/tableController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Get floor summary
router.get('/floor-summary', tableController.getFloorSummary);

// Get my tables (assigned to current waiter)
router.get('/my-tables', tableController.getMyTables);

// Get all tables
router.get('/', tableController.getAll);

// Get tables by status
router.get('/status/:status', tableController.getByStatus);

// Get single table
router.get('/:id', tableController.getById);

// Get table with current order
router.get('/:id/with-order', tableController.getWithOrder);

// Create table (admin only)
router.post('/', requireRole('admin'), tableController.create);

// Bulk create tables (admin only)
router.post('/bulk', requireRole('admin'), tableController.bulkCreate);

// Update table (admin only)
router.put('/:id', requireRole('admin'), tableController.update);
router.patch('/:id', requireRole('admin'), tableController.update);

// Update table status (admin, cashier, waiter)
router.post('/:id/status', tableController.updateStatus);
router.patch('/:id/status', tableController.updateStatus);

// Delete table (admin only)
router.delete('/:id', requireRole('admin'), tableController.delete);

// Restore table (admin only)
router.post('/:id/restore', requireRole('admin'), tableController.restore);

// Assign waiter to table (admin only)
router.post('/:id/assign-waiter', requireRole('admin'), tableController.assignWaiter);

// Get waiters for assignment
router.get('/waiters/list', tableController.getWaiters);

module.exports = router;
