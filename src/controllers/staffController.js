const { Staff, Restaurant } = require('../models');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const socketService = require('../services/socketService');

// Get all staff for restaurant
exports.getAll = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { role, isActive } = req.query;

    const filter = { restaurantId };
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';

    const staff = await Staff.find(filter)
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: staff
    });
  } catch (error) {
    next(error);
  }
};

// Get single staff member
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const staff = await Staff.findOne({ _id: id, restaurantId })
      .select('-password');

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    res.json({
      success: true,
      data: staff
    });
  } catch (error) {
    next(error);
  }
};

// Create new staff member
exports.create = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { firstName, lastName, phone, password, role, tableIds } = req.body;

    // Check if phone already exists
    const existingStaff = await Staff.findOne({ phone });
    if (existingStaff) {
      return res.status(400).json({
        success: false,
        message: 'Phone number already registered'
      });
    }

    const staff = await Staff.create({
      restaurantId,
      firstName,
      lastName,
      phone,
      password,
      role: role || 'waiter',
      tableIds: tableIds || []
    });

    // Remove password from response
    const staffResponse = staff.toObject();
    delete staffResponse.password;

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'staff:created', staffResponse);

    res.status(201).json({
      success: true,
      message: 'Staff created successfully',
      data: staffResponse
    });
  } catch (error) {
    next(error);
  }
};

// Update staff member
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const updates = req.body;

    // Don't allow password update through this endpoint
    delete updates.password;
    delete updates.restaurantId;

    const staff = await Staff.findOneAndUpdate(
      { _id: id, restaurantId },
      updates,
      { new: true, runValidators: true }
    ).select('-password');

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'staff:updated', staff);

    res.json({
      success: true,
      message: 'Staff updated successfully',
      data: staff
    });
  } catch (error) {
    next(error);
  }
};

// Change password
exports.changePassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const { currentPassword, newPassword } = req.body;

    const staff = await Staff.findOne({ _id: id, restaurantId });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Verify current password
    const isMatch = await staff.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    staff.password = newPassword;
    await staff.save();

    res.json({
      success: true,
      message: 'Password changed successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Reset password (admin only)
exports.resetPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const { newPassword } = req.body;

    const staff = await Staff.findOne({ _id: id, restaurantId });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    staff.password = newPassword;
    await staff.save();

    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete staff
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId, id: deletedBy } = req.user;

    const staff = await Staff.findOne({ _id: id, restaurantId });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    await staff.softDelete(deletedBy);

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'staff:deleted', { _id: id });

    res.json({
      success: true,
      message: 'Staff deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Restore deleted staff
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const staff = await Staff.findOneWithDeleted({ _id: id, restaurantId });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    await staff.restore();

    const restoredStaff = staff.toObject();
    delete restoredStaff.password;

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'staff:restored', restoredStaff);

    res.json({
      success: true,
      message: 'Staff restored successfully',
      data: restoredStaff
    });
  } catch (error) {
    next(error);
  }
};

// Assign tables to waiter
exports.assignTables = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const { tableIds } = req.body;

    const staff = await Staff.findOneAndUpdate(
      { _id: id, restaurantId },
      { tableIds },
      { new: true }
    ).select('-password');

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'staff:tables-assigned', {
      staffId: id,
      tableIds
    });

    res.json({
      success: true,
      message: 'Tables assigned successfully',
      data: staff
    });
  } catch (error) {
    next(error);
  }
};

// Update FCM token
exports.updateFcmToken = async (req, res, next) => {
  try {
    const { id } = req.user;
    const { fcmToken } = req.body;

    await Staff.findByIdAndUpdate(id, { fcmToken });

    res.json({
      success: true,
      message: 'FCM token updated'
    });
  } catch (error) {
    next(error);
  }
};

// Get waiters only
exports.getWaiters = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;

    const waiters = await Staff.find({
      restaurantId,
      role: 'waiter',
      isActive: true
    }).select('-password');

    res.json({
      success: true,
      data: waiters
    });
  } catch (error) {
    next(error);
  }
};

// ==================== FLUTTER COMPATIBILITY ====================

// Attendance - Ishga keldi/ketdi (Flutter waiter app uchun)
// POST /api/staff/attendance
exports.attendance = async (req, res, next) => {
  try {
    const { id: staffId } = req.user;
    const { type } = req.body; // 'check_in' or 'check_out'

    const staff = await Staff.findById(staffId);
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Toggle isWorking based on type
    // Flutter "keldi"/"ketdi" yuboradi, backend "check_in"/"check_out" ham qabul qiladi
    if (type === 'check_in' || type === 'keldi') {
      staff.isWorking = true;
    } else if (type === 'check_out' || type === 'ketdi') {
      staff.isWorking = false;
    } else {
      // Toggle if no type specified
      staff.isWorking = !staff.isWorking;
    }

    staff.lastSeenAt = new Date();
    await staff.save();

    // Socket orqali boshqa clientlarga xabar berish
    socketService.emitToRestaurant(staff.restaurantId, 'staff:attendance', {
      staffId: staff._id,
      isWorking: staff.isWorking,
      type: staff.isWorking ? 'check_in' : 'check_out'
    });

    res.json({
      success: true,
      isWorking: staff.isWorking,
      data: {
        _id: staff._id,
        isWorking: staff.isWorking,
        type: staff.isWorking ? 'keldi' : 'ketdi'
      },
      message: staff.isWorking ? 'Ishga keldingiz' : 'Ishdan ketdingiz'
    });
  } catch (error) {
    next(error);
  }
};

// Get today's attendance status (Flutter waiter app uchun)
// GET /api/staff/attendance/today
exports.getAttendanceToday = async (req, res, next) => {
  try {
    const { id: staffId } = req.user;

    const staff = await Staff.findById(staffId).select('isWorking lastSeenAt');
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Bugungi sana
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Flutter kutayotgan format - todayAttendances array
    const todayAttendances = [];
    if (staff.lastSeenAt) {
      const lastSeenDate = new Date(staff.lastSeenAt);
      // Agar lastSeenAt bugun bo'lsa
      if (lastSeenDate >= today) {
        todayAttendances.push({
          type: staff.isWorking ? 'keldi' : 'ketdi',
          createdAt: staff.lastSeenAt
        });
      }
    }

    res.json({
      success: true,
      isWorking: staff.isWorking,
      todayAttendances: todayAttendances,
      data: {
        staffId: staffId,
        isWorking: staff.isWorking,
        date: today.toISOString().split('T')[0],
        lastSeenAt: staff.lastSeenAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get attendance history (Flutter waiter app uchun)
// GET /api/staff/attendance/history
exports.getAttendanceHistory = async (req, res, next) => {
  try {
    const { id: staffId } = req.user;
    const { startDate, endDate } = req.query;

    const staff = await Staff.findById(staffId).select('isWorking lastSeenAt firstName lastName');
    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Hozircha oddiy response - kelgusida Attendance model qo'shilsa to'liq tarix bo'ladi
    const attendances = [];

    // Agar lastSeenAt bor bo'lsa, uni qo'shamiz
    if (staff.lastSeenAt) {
      attendances.push({
        _id: staffId,
        staffId: staffId,
        type: staff.isWorking ? 'keldi' : 'ketdi',
        createdAt: staff.lastSeenAt,
        date: staff.lastSeenAt.toISOString().split('T')[0]
      });
    }

    res.json({
      success: true,
      attendances: attendances,
      data: {
        staffId: staffId,
        staffName: `${staff.firstName} ${staff.lastName}`,
        isWorking: staff.isWorking,
        total: attendances.length
      }
    });
  } catch (error) {
    next(error);
  }
};
