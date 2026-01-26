const express = require('express');
const router = express.Router();
const hisobotController = require('../controllers/hisobotController');
const { auth } = require('../middleware/auth');
const { requireRole } = require('../middleware/roleCheck');

// Barcha route'lar authentication va admin/cashier roli talab qiladi
router.use(auth);
router.use(requireRole('admin', 'cashier'));

/**
 * ASOSIY HISOBOT
 * GET /api/hisobot
 * Query params:
 *   - period: 'today' | 'yesterday' | 'week' | '10days' | 'month'
 *   - startDate: YYYY-MM-DD (ixtiyoriy - period o'rniga)
 *   - endDate: YYYY-MM-DD (ixtiyoriy)
 *   - startTime: HH:mm (ixtiyoriy)
 *   - endTime: HH:mm (ixtiyoriy)
 */
router.get('/', hisobotController.getFullReport);

/**
 * TO'LANGAN BUYURTMALAR RO'YXATI
 * GET /api/hisobot/payments
 * Query params: period, startDate, endDate, startTime, endTime, paymentType
 */
router.get('/payments', hisobotController.getPaymentsList);

/**
 * KUNLIK HISOBOT TARIXI
 * GET /api/hisobot/daily-history
 * Query params:
 *   - days: number (default: 30)
 */
router.get('/daily-history', hisobotController.getDailyHistory);

module.exports = router;
