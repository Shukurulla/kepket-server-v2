const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { auth } = require('../middleware/auth');

// Public routes
router.post('/login', authController.login);

// Protected routes
router.get('/me', auth, authController.getMe);
router.post('/logout', auth, authController.logout);
router.patch('/profile', auth, authController.updateProfile);
router.post('/change-password', auth, authController.changePassword);
router.post('/toggle-working', auth, authController.toggleWorking);

module.exports = router;
