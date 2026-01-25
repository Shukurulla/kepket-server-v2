const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Get my notifications
router.get('/', notificationController.getMyNotifications);

// Get unread count
router.get('/unread-count', notificationController.getUnreadCount);

// Get count (Flutter compatibility) - /notifications/count?recipientId=xxx&status=pending
router.get('/count', notificationController.getCount);

// Get notification settings
router.get('/settings', notificationController.getSettings);

// Update notification settings
router.put('/settings', notificationController.updateSettings);

// Mark all as read
router.post('/mark-all-read', notificationController.markAllAsRead);

// Complete order notifications (Flutter compatibility) - PATCH /notifications/order/:orderId/complete
// MUHIM: Bu /:id dan OLDIN bo'lishi kerak!
router.patch('/order/:orderId/complete', notificationController.completeOrderNotifications);

// Mark notification as read - PATCH /notifications/:id/read
// MUHIM: Bu /:id dan OLDIN bo'lishi kerak!
router.patch('/:id/read', notificationController.markAsRead);

// Update notification (Flutter compatibility) - PATCH /notifications/:id
router.patch('/:id', notificationController.updateNotification);

// Create notification (admin only)
router.post('/', requireRole('admin'), notificationController.create);

// Broadcast notification (admin only)
router.post('/broadcast', requireRole('admin'), notificationController.broadcast);

// Clear old notifications (admin only)
router.post('/clear-old', requireRole('admin'), notificationController.clearOld);

// Delete notification
router.delete('/:id', notificationController.delete);

module.exports = router;
