const express = require('express');
const router = express.Router();
const staffController = require('../controllers/staffController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// All routes require authentication
router.use(auth);

// Attendance - ishga keldi/ketdi (Flutter waiter app uchun)
// MUHIM: Bu /:id dan OLDIN bo'lishi kerak!
router.post('/attendance', staffController.attendance);

// Get all staff (admin, cashier)
router.get('/', requireRole('admin', 'cashier'), staffController.getAll);

// Get waiters only
router.get('/waiters', staffController.getWaiters);

// Get single staff
router.get('/:id', requireRole('admin', 'cashier'), staffController.getById);

// Create staff (admin only)
router.post('/', requireRole('admin'), staffController.create);

// Update staff (admin only)
router.put('/:id', requireRole('admin'), staffController.update);
router.patch('/:id', requireRole('admin'), staffController.update);

// Change own password
router.post('/change-password', async (req, res, next) => {
  req.params.id = req.user.id;
  staffController.changePassword(req, res, next);
});

// Reset password (admin only)
router.post('/:id/reset-password', requireRole('admin'), staffController.resetPassword);

// Assign tables (admin only)
router.post('/:id/assign-tables', requireRole('admin'), staffController.assignTables);

// Update FCM token
router.post('/fcm-token', staffController.updateFcmToken);

// Delete staff (admin only)
router.delete('/:id', requireRole('admin'), staffController.delete);

// Restore deleted staff (admin only)
router.post('/:id/restore', requireRole('admin'), staffController.restore);

module.exports = router;
