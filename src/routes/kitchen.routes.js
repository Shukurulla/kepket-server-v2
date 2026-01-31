const express = require('express');
const router = express.Router();
const kitchenController = require('../controllers/kitchenController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Get kitchen statistics
router.get('/stats', kitchenController.getStats);

// Get kitchen orders (cook, admin, cashier)
router.get('/orders', kitchenController.getOrders);

// Get single order
router.get('/orders/:id', kitchenController.getOrder);

// Start preparing order (cook)
router.post('/orders/:orderId/start', requireRole('cook', 'admin'), kitchenController.startOrder);

// Start preparing single item (cook) - Boshlandi button
router.post(
  '/orders/:orderId/items/:itemId/start',
  requireRole('cook', 'admin'),
  kitchenController.startItem
);

// Complete order (cook)
router.post('/orders/:orderId/complete', requireRole('cook', 'admin'), kitchenController.completeOrder);

// Update item status (cook)
router.patch(
  '/orders/:orderId/items/:itemId/status',
  requireRole('cook', 'admin'),
  kitchenController.updateItemStatus
);

// Call waiter
router.post('/call-waiter', requireRole('cook', 'admin'), kitchenController.callWaiter);

// ============================================================
// 🖨️ PRINTER PENDING SYSTEM - Cook offline bo'lganda ham print
// ============================================================

// Get pending items (cook online bo'lganda)
router.get('/pending-items', requireRole('cook', 'admin'), kitchenController.getPendingItems);

// Bulk update printer status (bir nechta item)
router.post('/bulk-update-printer-status', requireRole('cook', 'admin'), kitchenController.bulkUpdatePrinterStatus);

// Update single item printer status
router.patch('/items/:itemId/printer-status', requireRole('cook', 'admin'), kitchenController.updateItemPrinterStatus);

module.exports = router;
