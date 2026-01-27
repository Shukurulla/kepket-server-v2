const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');
const { deduplication } = require('../middleware/deduplication');

// All routes require authentication
router.use(auth);

// List & Summary
router.get('/', orderController.getOrders);
router.get('/today', orderController.getTodayOrders);
router.get('/summary', orderController.getDailySummary);
router.get('/daily-summary', orderController.getDailySummary); // Backward compat
router.get('/waiter-stats', orderController.getWaiterStats);

// Special order types (BEFORE /:id to avoid route conflicts)
router.post('/personal', requireRole('waiter'), orderController.createPersonalOrder);
router.post('/saboy', requireRole('cashier', 'admin'), orderController.createSaboyOrder);
router.post('/merge', requireRole('cashier', 'admin'), orderController.mergeOrders);

// TZ 3.3: Arxivlangan buyurtmalar (kunlik)
router.get('/archive/:date', orderController.getArchivedOrders);

// TZ 3.4: Ofitsiant kunlik daromadi
router.get('/waiter-income/:waiterId', orderController.getWaiterDailyIncome);
router.get('/my-income', requireRole('waiter'), orderController.getMyDailyIncome);

// CRUD
router.post('/', deduplication(5000), orderController.createOrder);
router.get('/:id', orderController.getOrder);
router.patch('/:id', orderController.updateOrder);
router.delete('/:id', orderController.deleteOrder);

// Order actions
router.post('/:id/approve', requireRole('waiter', 'admin'), orderController.approveOrder);
router.post('/:id/reject', requireRole('waiter', 'admin'), orderController.rejectOrder);
router.post('/:id/pay', requireRole('cashier', 'admin'), orderController.processPayment);
router.patch('/:id/waiter', requireRole('admin'), orderController.changeWaiter);

// Partial payment (qisman to'lov)
router.post('/:id/pay-items', requireRole('cashier', 'admin'), orderController.processPartialPayment);
router.get('/:id/unpaid-items', orderController.getUnpaidItems);

// Item actions
router.post('/:id/items', deduplication(3000), orderController.addItems);
router.delete('/:id/items/:itemId', orderController.deleteItem);
router.patch('/:id/items/:itemId/quantity', orderController.updateItemQuantity);
router.patch('/:id/items/:itemId/ready', requireRole('cook', 'admin'), orderController.markItemReady);
router.patch('/:id/items/:itemId/partial-ready', requireRole('cook', 'admin'), orderController.markItemPartialReady);

// TZ 1.1: Admin uchun itemni bekor qilish
router.post('/:id/items/:itemId/cancel', requireRole('admin'), orderController.cancelItem);

// TZ 3.5: Stolni ko'chirish
router.post('/:id/transfer', requireRole('waiter', 'admin'), orderController.transferOrder);

module.exports = router;
