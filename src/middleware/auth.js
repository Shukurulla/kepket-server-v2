const jwt = require('jsonwebtoken');
const { Staff } = require('../models');
const config = require('../config/env');

/**
 * Verify JWT token and attach user to request
 */
const auth = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token topilmadi'
        }
      });
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = jwt.verify(token, config.JWT_SECRET);

    // Get user from database
    const user = await Staff.findById(decoded.id);

    if (!user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Foydalanuvchi topilmadi'
        }
      });
    }

    if (user.isDeleted) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Akkaunt o\'chirilgan'
        }
      });
    }

    if (user.status === 'fired') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Akkaunt bloklangan'
        }
      });
    }

    // Attach user info to request
    req.user = {
      id: user._id,
      restaurantId: user.restaurantId,
      role: user.role,
      fullName: user.fullName
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_TOKEN',
          message: 'Noto\'g\'ri token'
        }
      });
    }

    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Token muddati tugagan'
        }
      });
    }

    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'SERVER_ERROR',
        message: 'Server xatosi'
      }
    });
  }
};

/**
 * Optional auth - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await Staff.findById(decoded.id);

    if (user && !user.isDeleted && user.status !== 'fired') {
      req.user = {
        id: user._id,
        restaurantId: user.restaurantId,
        role: user.role,
        fullName: user.fullName
      };
    }

    next();
  } catch (error) {
    // Silently continue without auth
    next();
  }
};

/**
 * Generate JWT token
 */
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, config.JWT_SECRET, {
    expiresIn: config.JWT_EXPIRES_IN
  });
};

/**
 * Verify token (for socket auth)
 */
const verifyToken = async (token) => {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    const user = await Staff.findById(decoded.id);

    if (!user || user.isDeleted || user.status === 'fired') {
      return null;
    }

    return {
      id: user._id,
      restaurantId: user.restaurantId,
      role: user.role,
      fullName: user.fullName
    };
  } catch (error) {
    return null;
  }
};

module.exports = {
  auth,
  optionalAuth,
  generateToken,
  verifyToken
};
