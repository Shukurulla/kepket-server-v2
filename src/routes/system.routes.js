const express = require('express');
const router = express.Router();
const systemController = require('../controllers/systemController');
const { auth } = require('../middleware/auth');

// TZ 5.1: Server vaqtini olish (autentifikatsiya talab qilinmaydi)
router.get('/time', systemController.getServerTime);

// System health check
router.get('/health', systemController.getHealth);

module.exports = router;
