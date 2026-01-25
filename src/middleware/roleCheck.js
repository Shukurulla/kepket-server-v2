/**
 * Role-based access control middleware
 */

/**
 * Check if user has one of the allowed roles
 * @param  {...string} roles - Allowed roles
 */
const requireRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'Avtorizatsiya talab qilinadi'
        }
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Bu amal uchun ruxsat yo\'q'
        }
      });
    }

    next();
  };
};

/**
 * Require admin role
 */
const requireAdmin = requireRole('admin');

/**
 * Require waiter role
 */
const requireWaiter = requireRole('waiter');

/**
 * Require cook role
 */
const requireCook = requireRole('cook');

/**
 * Require cashier role
 */
const requireCashier = requireRole('cashier');

/**
 * Require any staff role (not admin)
 */
const requireStaff = requireRole('waiter', 'cook', 'cashier');

/**
 * Require admin or cashier
 */
const requireAdminOrCashier = requireRole('admin', 'cashier');

/**
 * Require waiter or admin
 */
const requireWaiterOrAdmin = requireRole('waiter', 'admin');

module.exports = {
  requireRole,
  requireAdmin,
  requireWaiter,
  requireCook,
  requireCashier,
  requireStaff,
  requireAdminOrCashier,
  requireWaiterOrAdmin
};
