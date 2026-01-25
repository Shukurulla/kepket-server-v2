const { Table, Order, Staff } = require('../models');
const socketService = require('../services/socketService');

// Get all tables
exports.getAll = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { status, floor } = req.query;

    const filter = { restaurantId };
    if (status) filter.status = status;
    if (floor) filter.floor = parseInt(floor);

    const tables = await Table.find(filter)
      .populate('currentOrderId')
      .sort({ floor: 1, number: 1 });

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
      .populate('currentOrderId');

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

    const tables = await Table.find({ restaurantId, status })
      .populate('currentOrderId')
      .sort({ floor: 1, number: 1 });

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

    const staff = await Staff.findById(staffId);
    if (!staff || !staff.tableIds || staff.tableIds.length === 0) {
      return res.json({
        success: true,
        data: []
      });
    }

    const tables = await Table.find({
      _id: { $in: staff.tableIds },
      restaurantId
    })
      .populate('currentOrderId')
      .sort({ floor: 1, number: 1 });

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
    const { number, capacity, floor, position } = req.body;

    // Check if table number already exists
    const existingTable = await Table.findOne({
      restaurantId,
      number,
      floor: floor || 1
    });

    if (existingTable) {
      return res.status(400).json({
        success: false,
        message: `Table ${number} already exists on floor ${floor || 1}`
      });
    }

    const table = await Table.create({
      restaurantId,
      number,
      capacity: capacity || 4,
      floor: floor || 1,
      position,
      status: 'available'
    });

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
    const { tables } = req.body; // Array of { number, capacity, floor }

    if (!Array.isArray(tables) || tables.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'tables must be a non-empty array'
      });
    }

    const createdTables = [];
    const errors = [];

    for (const tableData of tables) {
      try {
        const existingTable = await Table.findOne({
          restaurantId,
          number: tableData.number,
          floor: tableData.floor || 1
        });

        if (existingTable) {
          errors.push(`Table ${tableData.number} already exists on floor ${tableData.floor || 1}`);
          continue;
        }

        const table = await Table.create({
          restaurantId,
          number: tableData.number,
          capacity: tableData.capacity || 4,
          floor: tableData.floor || 1,
          status: 'available'
        });
        createdTables.push(table);
      } catch (err) {
        errors.push(`Failed to create table ${tableData.number}: ${err.message}`);
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
    delete updates.currentOrderId;

    const table = await Table.findOneAndUpdate(
      { _id: id, restaurantId },
      updates,
      { new: true, runValidators: true }
    ).populate('currentOrderId');

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

    const validStatuses = ['available', 'occupied', 'reserved', 'cleaning'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const table = await Table.findOneAndUpdate(
      { _id: id, restaurantId },
      { status },
      { new: true }
    ).populate('currentOrderId');

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'table:status-changed', {
      tableId: id,
      status,
      table
    });

    res.json({
      success: true,
      message: `Table status changed to ${status}`,
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
    if (table.status === 'occupied' && table.currentOrderId) {
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

    let currentOrder = null;
    if (table.currentOrderId) {
      currentOrder = await Order.findById(table.currentOrderId)
        .populate('items.foodId', 'name price image')
        .populate('waiterId', 'firstName lastName');
    }

    res.json({
      success: true,
      data: {
        ...table.toObject(),
        currentOrder
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get floor summary
exports.getFloorSummary = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;

    const summary = await Table.aggregate([
      { $match: { restaurantId: restaurantId, isDeleted: { $ne: true } } },
      {
        $group: {
          _id: '$floor',
          total: { $sum: 1 },
          available: {
            $sum: { $cond: [{ $eq: ['$status', 'available'] }, 1, 0] }
          },
          occupied: {
            $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] }
          },
          reserved: {
            $sum: { $cond: [{ $eq: ['$status', 'reserved'] }, 1, 0] }
          },
          cleaning: {
            $sum: { $cond: [{ $eq: ['$status', 'cleaning'] }, 1, 0] }
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
