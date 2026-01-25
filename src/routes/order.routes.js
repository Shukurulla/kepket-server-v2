const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// List & Summary
router.get('/', orderController.getOrders);
router.get('/today', orderController.getTodayOrders);
router.get('/summary', orderController.getDailySummary);
router.get('/daily-summary', orderController.getDailySummary); // Backward compat
router.get('/waiter-stats', orderController.getWaiterStats);

// CRUD
router.post('/', orderController.createOrder);
router.get('/:id', orderController.getOrder);
router.patch('/:id', orderController.updateOrder);
router.delete('/:id', orderController.deleteOrder);

// Order actions
router.post('/:id/approve', requireRole('waiter', 'admin'), orderController.approveOrder);
router.post('/:id/reject', requireRole('waiter', 'admin'), orderController.rejectOrder);
router.post('/:id/pay', requireRole('cashier', 'admin'), orderController.processPayment);
router.patch('/:id/waiter', requireRole('admin'), orderController.changeWaiter);

// Item actions
router.post('/:id/items', orderController.addItems);
router.delete('/:id/items/:itemId', orderController.deleteItem);
router.patch('/:id/items/:itemId/quantity', orderController.updateItemQuantity);
router.patch('/:id/items/:itemId/ready', requireRole('cook', 'admin'), orderController.markItemReady);
router.patch('/:id/items/:itemId/partial-ready', requireRole('cook', 'admin'), orderController.markItemPartialReady);

module.exports = router;
