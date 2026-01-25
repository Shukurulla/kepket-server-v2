const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');

// Get nonce by table ID
router.get('/table/:tableId/nonce', qrController.getNonce);

// Get nonce by table data (tableId-restaurantId format)
router.get('/table-data/:tableData/nonce', qrController.getNonceByTableData);

// Create session
router.post('/session/create', qrController.createSession);

// Get session status
router.get('/session/status', qrController.getSessionStatus);

// Extend session
router.post('/session/extend', qrController.extendSession);

module.exports = router;
