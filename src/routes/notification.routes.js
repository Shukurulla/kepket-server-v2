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

// Get notification settings
router.get('/settings', notificationController.getSettings);

// Update notification settings
router.put('/settings', notificationController.updateSettings);

// Mark notification as read
router.patch('/:id/read', notificationController.markAsRead);

// Mark all as read
router.post('/mark-all-read', notificationController.markAllAsRead);

// Create notification (admin only)
router.post('/', requireRole('admin'), notificationController.create);

// Broadcast notification (admin only)
router.post('/broadcast', requireRole('admin'), notificationController.broadcast);

// Clear old notifications (admin only)
router.post('/clear-old', requireRole('admin'), notificationController.clearOld);

// Delete notification
router.delete('/:id', notificationController.delete);

module.exports = router;
