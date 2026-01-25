const { Table, Order, Staff } = require('../models');
const socketService = require('../services/socketService');

// Get all tables
exports.getAll = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { status, location } = req.query;

    const filter = { restaurantId };
    if (status) filter.status = status;
    if (location) filter.location = location;

    const tables = await Table.find(filter)
      .populate('activeOrderId')
      .populate('assignedWaiterId', 'firstName lastName')
      .sort({ title: 1 });

    res.json({
      success: true,
      data: tables
    });
  } catch (error) {
    next(error);
  }
};

// Get table by ID
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const table = await Table.findOne({ _id: id, restaurantId })
      .populate('activeOrderId')
      .populate('assignedWaiterId', 'firstName lastName');

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    res.json({
      success: true,
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Get tables by status
exports.getByStatus = async (req, res, next) => {
  try {
    const { status } = req.params;
    const { restaurantId } = req.user;

    // Map old status names
    const statusMap = { 'available': 'free', 'cleaning': 'free' };
    const mappedStatus = statusMap[status] || status;

    const tables = await Table.find({ restaurantId, status: mappedStatus })
      .populate('activeOrderId')
      .populate('assignedWaiterId', 'firstName lastName')
      .sort({ title: 1 });

    res.json({
      success: true,
      data: tables
    });
  } catch (error) {
    next(error);
  }
};

// Get tables assigned to current waiter
exports.getMyTables = async (req, res, next) => {
  try {
    const { restaurantId, id: staffId } = req.user;

    const tables = await Table.find({
      restaurantId,
      assignedWaiterId: staffId
    })
      .populate('activeOrderId')
      .sort({ title: 1 });

    res.json({
      success: true,
      data: tables
    });
  } catch (error) {
    next(error);
  }
};

// Create table
exports.create = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const {
      title,
      capacity,
      location,
      hasHourlyCharge,
      hourlyChargeAmount,
      surcharge,
      assignedWaiterId
    } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Title is required'
      });
    }

    // Check if table title already exists
    const existingTable = await Table.findOne({
      restaurantId,
      title
    });

    if (existingTable) {
      return res.status(400).json({
        success: false,
        message: `"${title}" nomli stol allaqachon mavjud`
      });
    }

    const table = await Table.create({
      restaurantId,
      title,
      capacity: capacity || 4,
      location: location || 'indoor',
      hasHourlyCharge: hasHourlyCharge || false,
      hourlyChargeAmount: hourlyChargeAmount || 0,
      surcharge: surcharge || 0,
      assignedWaiterId,
      status: 'free'
    });

    await table.populate('assignedWaiterId', 'firstName lastName');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'table:created', table);

    res.status(201).json({
      success: true,
      message: 'Table created successfully',
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Bulk create tables
exports.bulkCreate = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { tables, count, prefix } = req.body;

    // Support both array format and count format
    let tablesToCreate = tables;
    if (!tables && count) {
      tablesToCreate = [];
      const tablePrefix = prefix || 'Stol';
      for (let i = 1; i <= count; i++) {
        tablesToCreate.push({
          title: `${tablePrefix} ${i}`
        });
      }
    }

    if (!Array.isArray(tablesToCreate) || tablesToCreate.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'tables must be a non-empty array or provide count'
      });
    }

    const createdTables = [];
    const errors = [];

    for (const tableData of tablesToCreate) {
      try {
        const existingTable = await Table.findOne({
          restaurantId,
          title: tableData.title
        });

        if (existingTable) {
          errors.push(`"${tableData.title}" allaqachon mavjud`);
          continue;
        }

        const table = await Table.create({
          restaurantId,
          title: tableData.title,
          capacity: tableData.capacity || 4,
          location: tableData.location || 'indoor',
          hasHourlyCharge: tableData.hasHourlyCharge || false,
          hourlyChargeAmount: tableData.hourlyChargeAmount || 0,
          status: 'free'
        });
        createdTables.push(table);
      } catch (err) {
        errors.push(`Failed to create table: ${err.message}`);
      }
    }

    // Emit socket event
    if (createdTables.length > 0) {
      socketService.emitToRestaurant(restaurantId, 'tables:bulk-created', createdTables);
    }

    res.status(201).json({
      success: true,
      message: `${createdTables.length} tables created`,
      data: createdTables,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    next(error);
  }
};

// Update table
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const updates = req.body;

    delete updates.restaurantId;
    delete updates.activeOrderId;

    const table = await Table.findOneAndUpdate(
      { _id: id, restaurantId },
      updates,
      { new: true, runValidators: true }
    )
      .populate('activeOrderId')
      .populate('assignedWaiterId', 'firstName lastName');

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'table:updated', table);

    res.json({
      success: true,
      message: 'Table updated successfully',
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Update table status
exports.updateStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const { status } = req.body;

    // Map old status names to new ones
    const statusMap = {
      'available': 'free',
      'cleaning': 'free'
    };
    const mappedStatus = statusMap[status] || status;

    const validStatuses = ['free', 'occupied', 'reserved'];
    if (!validStatuses.includes(mappedStatus)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const table = await Table.findOneAndUpdate(
      { _id: id, restaurantId },
      { status: mappedStatus },
      { new: true }
    )
      .populate('activeOrderId')
      .populate('assignedWaiterId', 'firstName lastName');

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'table:status-changed', {
      tableId: id,
      status: mappedStatus,
      table
    });

    res.json({
      success: true,
      message: `Table status changed to ${mappedStatus}`,
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Delete table (soft delete)
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId, id: deletedBy } = req.user;

    const table = await Table.findOne({ _id: id, restaurantId });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Check if table has active order
    if (table.status === 'occupied' && table.activeOrderId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete table with active order'
      });
    }

    await table.softDelete(deletedBy);

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'table:deleted', { _id: id });

    res.json({
      success: true,
      message: 'Table deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Restore table
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const table = await Table.findOneWithDeleted({ _id: id, restaurantId });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    await table.restore();

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'table:restored', table);

    res.json({
      success: true,
      message: 'Table restored successfully',
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Get table with current order details
exports.getWithOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const table = await Table.findOne({ _id: id, restaurantId });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    let activeOrder = null;
    if (table.activeOrderId) {
      activeOrder = await Order.findById(table.activeOrderId)
        .populate('items.foodId', 'foodName price image')
        .populate('waiterId', 'firstName lastName');
    }

    res.json({
      success: true,
      data: {
        ...table.toObject(),
        activeOrder
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get location summary
exports.getFloorSummary = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;

    const summary = await Table.aggregate([
      { $match: { restaurantId: restaurantId, isDeleted: { $ne: true } } },
      {
        $group: {
          _id: '$location',
          total: { $sum: 1 },
          free: {
            $sum: { $cond: [{ $eq: ['$status', 'free'] }, 1, 0] }
          },
          occupied: {
            $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] }
          },
          reserved: {
            $sum: { $cond: [{ $eq: ['$status', 'reserved'] }, 1, 0] }
          }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
};

// Assign waiter to table
exports.assignWaiter = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const { waiterId } = req.body;

    const table = await Table.findOne({ _id: id, restaurantId });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Verify waiter exists
    if (waiterId) {
      const waiter = await Staff.findOne({
        _id: waiterId,
        restaurantId,
        role: 'waiter'
      });
      if (!waiter) {
        return res.status(400).json({
          success: false,
          message: 'Waiter not found'
        });
      }
    }

    table.assignedWaiterId = waiterId || null;
    await table.save();
    await table.populate('assignedWaiterId', 'firstName lastName');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'table:waiter-assigned', {
      tableId: id,
      waiterId,
      table
    });

    res.json({
      success: true,
      message: waiterId ? 'Waiter assigned successfully' : 'Waiter removed',
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Get waiters for assignment
exports.getWaiters = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;

    const waiters = await Staff.find({
      restaurantId,
      role: 'waiter',
      status: 'working'
    }).select('firstName lastName isWorking isOnline');

    res.json({
      success: true,
      data: waiters
    });
  } catch (error) {
    next(error);
  }
};
