const express = require('express');
const router = express.Router();
const shiftController = require('../controllers/shiftController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// Barcha routelar avtorizatsiya talab qiladi
router.use(auth);

// Aktiv smenani olish (barcha xodimlar)
router.get('/active', shiftController.getActiveShift);

// Smena tarixi (faqat admin)
router.get('/history', requireRole('admin'), shiftController.getShiftHistory);

// Yangi smena ochish (faqat admin)
router.post('/open', requireRole('admin'), shiftController.openShift);

// Smena detallari (barcha xodimlar)
router.get('/:id', shiftController.getShiftById);

// Smena hisoboti (faqat admin)
router.get('/:id/report', requireRole('admin'), shiftController.getShiftReport);

// Smena buyurtmalari
router.get('/:id/orders', shiftController.getShiftOrders);

// Smenani yopish (faqat admin)
router.post('/:id/close', requireRole('admin'), shiftController.closeShift);

// Smena izohlarini yangilash (faqat admin)
router.patch('/:id/notes', requireRole('admin'), shiftController.updateShiftNotes);

module.exports = router;
