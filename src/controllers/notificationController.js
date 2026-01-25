const { Notification, Staff } = require('../models');
const socketService = require('../services/socketService');

// Get my notifications
exports.getMyNotifications = async (req, res, next) => {
  try {
    const { restaurantId, id: userId, role } = req.user;
    const { unreadOnly, limit = 50, skip = 0, recipientId, status } = req.query;

    // Flutter compatibility: recipientId yoki userId
    const targetStaffId = recipientId || userId;

    const filter = {
      restaurantId,
      staffId: targetStaffId
    };

    // Flutter status: pending -> isRead: false, completed -> isRead: true
    if (status === 'pending') {
      filter.isRead = false;
    } else if (status === 'completed') {
      filter.isRead = true;
    } else if (unreadOnly === 'true') {
      filter.isRead = false;
    }

    const notifications = await Notification.find(filter)
      .populate('orderId', 'orderNumber tableNumber tableName items')
      .populate('tableId', 'title number tableNumber')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip(parseInt(skip));

    const total = await Notification.countDocuments(filter);
    const unreadCount = await Notification.countDocuments({
      ...filter,
      isRead: false
    });

    // Flutter format: tableName, tableNumber, items
    const formattedNotifications = notifications.map(n => {
      const order = n.orderId;
      return {
        _id: n._id,
        id: n._id,
        type: n.type,
        title: n.title,
        message: n.message,
        tableName: n.tableId?.title || order?.tableName || `Stol ${n.tableId?.number || order?.tableNumber || ''}`,
        tableNumber: n.tableId?.number || order?.tableNumber || 0,
        orderId: order?._id?.toString() || n.orderId?.toString(),
        items: (order?.items || n.items || []).filter(i => !i.isDeleted).map(i => ({
          foodName: i.foodName || i.foodId?.name || 'Taom',
          quantity: i.quantity || 1
        })),
        isRead: n.isRead,
        isCompleted: n.isCompleted,
        createdAt: n.createdAt,
        completedAt: n.isRead ? n.readAt : null
      };
    });

    res.json({
      success: true,
      data: {
        notifications: formattedNotifications,
        total,
        unreadCount
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get unread count
exports.getUnreadCount = async (req, res, next) => {
  try {
    const { restaurantId, id: userId } = req.user;

    const count = await Notification.countDocuments({
      restaurantId,
      staffId: userId,
      isRead: false
    });

    res.json({
      success: true,
      data: { count }
    });
  } catch (error) {
    next(error);
  }
};

// Mark notification as read
exports.markAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;

    const notification = await Notification.findByIdAndUpdate(
      id,
      {
        isRead: true,
        readAt: new Date(),
        readBy: userId
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    next(error);
  }
};

// Mark all as read
exports.markAllAsRead = async (req, res, next) => {
  try {
    const { restaurantId, id: userId } = req.user;

    await Notification.updateMany(
      {
        restaurantId,
        staffId: userId,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date()
      }
    );

    res.json({
      success: true,
      message: 'All notifications marked as read'
    });
  } catch (error) {
    next(error);
  }
};

// Create notification (admin, system)
exports.create = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const {
      type,
      title,
      message,
      targetRole,
      targetUserId,
      data,
      priority
    } = req.body;

    const notification = await Notification.create({
      restaurantId,
      type: type || 'info',
      title,
      message,
      targetRole: targetRole || 'all',
      targetUserId,
      data,
      priority: priority || 'normal'
    });

    // Emit socket event based on target
    if (targetUserId) {
      socketService.emitToUser(targetUserId.toString(), 'notification:new', notification);
    } else if (targetRole && targetRole !== 'all') {
      socketService.emitToRole(restaurantId, targetRole, 'notification:new', notification);
    } else {
      socketService.emitToRestaurant(restaurantId, 'notification:new', notification);
    }

    res.status(201).json({
      success: true,
      message: 'Notification created',
      data: notification
    });
  } catch (error) {
    next(error);
  }
};

// Delete notification
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: deletedBy } = req.user;

    const notification = await Notification.findById(id);

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    await notification.softDelete(deletedBy);

    res.json({
      success: true,
      message: 'Notification deleted'
    });
  } catch (error) {
    next(error);
  }
};

// Clear old notifications (admin)
exports.clearOld = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { days = 30 } = req.body;

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await Notification.updateMany(
      {
        restaurantId,
        createdAt: { $lt: cutoffDate }
      },
      {
        isDeleted: true,
        deletedAt: new Date()
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} old notifications cleared`
    });
  } catch (error) {
    next(error);
  }
};

// Send broadcast notification (admin)
exports.broadcast = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { title, message, targetRole, priority } = req.body;

    const notification = await Notification.create({
      restaurantId,
      type: 'broadcast',
      title,
      message,
      targetRole: targetRole || 'all',
      priority: priority || 'high'
    });

    // Emit to all or specific role
    if (targetRole && targetRole !== 'all') {
      socketService.emitToRole(restaurantId, targetRole, 'notification:broadcast', notification);
    } else {
      socketService.emitToRestaurant(restaurantId, 'notification:broadcast', notification);
    }

    res.status(201).json({
      success: true,
      message: 'Broadcast sent',
      data: notification
    });
  } catch (error) {
    next(error);
  }
};

// Get notification settings
exports.getSettings = async (req, res, next) => {
  try {
    const { id: userId } = req.user;

    const staff = await Staff.findById(userId).select('notificationSettings fcmToken');

    res.json({
      success: true,
      data: {
        settings: staff?.notificationSettings || {
          sound: true,
          vibration: true,
          orderAlerts: true,
          kitchenAlerts: true
        },
        hasFcmToken: !!staff?.fcmToken
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update notification settings
exports.updateSettings = async (req, res, next) => {
  try {
    const { id: userId } = req.user;
    const settings = req.body;

    await Staff.findByIdAndUpdate(userId, {
      notificationSettings: settings
    });

    res.json({
      success: true,
      message: 'Settings updated'
    });
  } catch (error) {
    next(error);
  }
};

// ==================== FLUTTER COMPATIBILITY ====================

// Get count (Flutter waiter app uchun)
// GET /notifications/count?recipientId=xxx&status=pending
exports.getCount = async (req, res, next) => {
  try {
    const { restaurantId, id: userId } = req.user;
    const { recipientId, status } = req.query;

    // recipientId berilgan bo'lsa, shu user uchun, aks holda authenticated user uchun
    const targetStaffId = recipientId || userId;

    const filter = {
      restaurantId,
      staffId: targetStaffId
    };

    // status=pending -> isRead: false
    // status=completed -> isRead: true
    if (status === 'pending') {
      filter.isRead = false;
    } else if (status === 'completed') {
      filter.isRead = true;
    }

    const count = await Notification.countDocuments(filter);

    res.json({
      success: true,
      count,
      data: { count }
    });
  } catch (error) {
    next(error);
  }
};

// Update notification (Flutter waiter app uchun)
// PATCH /notifications/:id
exports.updateNotification = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user;
    const { status } = req.body;

    const updateData = {};

    // status=completed -> isRead: true
    if (status === 'completed') {
      updateData.isRead = true;
      updateData.readAt = new Date();
      updateData.readBy = userId;
    }

    const notification = await Notification.findByIdAndUpdate(
      id,
      updateData,
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.json({
      success: true,
      data: notification
    });
  } catch (error) {
    next(error);
  }
};

// Complete order notifications (Flutter waiter app uchun)
// PATCH /notifications/order/:orderId/complete
exports.completeOrderNotifications = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { id: userId } = req.user;

    // orderId bilan bog'liq barcha notificationlarni completed qilish
    const result = await Notification.updateMany(
      {
        'data.orderId': orderId,
        isRead: false
      },
      {
        isRead: true,
        readAt: new Date(),
        readBy: userId
      }
    );

    res.json({
      success: true,
      message: `${result.modifiedCount} notifications completed`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
};
