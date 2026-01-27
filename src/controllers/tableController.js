const { Table, Order, Staff, Shift } = require('../models');
const socketService = require('../services/socketService');

// Get all tables
exports.getAll = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { status, location, categoryId } = req.query;

    const filter = { restaurantId };
    if (status) filter.status = status;
    if (location) filter.location = location;
    if (categoryId) filter.categoryId = categoryId;

    // Aktiv smenani olish
    const activeShift = await Shift.findOne({
      restaurantId,
      status: 'open'
    });

    const tables = await Table.find(filter)
      .populate({
        path: 'activeOrderId',
        populate: {
          path: 'waiterId',
          select: 'firstName lastName'
        }
      })
      .populate('assignedWaiterId', 'firstName lastName')
      .populate('categoryId', 'title icon')
      .sort({ title: 1 });

    // MUHIM: Stollarni aktiv smenaga qarab filterlash
    const processedTables = tables.map(table => {
      const tableObj = table.toObject();

      // Agar stol band bo'lsa va activeOrderId mavjud bo'lsa
      if (tableObj.activeOrderId && tableObj.status === 'occupied') {
        const order = tableObj.activeOrderId;

        // Aktiv smena yo'q bo'lsa - stolni bo'sh ko'rsatish
        if (!activeShift) {
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        }
        // Order boshqa smenaga tegishli bo'lsa - stolni bo'sh ko'rsatish
        else if (order.shiftId && order.shiftId.toString() !== activeShift._id.toString()) {
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        }
        // Agar order shiftId yo'q bo'lsa - aktiv smenada yaratilgan deb hisoblaymiz (band qoladi)
      }

      return tableObj;
    });

    res.json({
      success: true,
      data: processedTables
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

    // Aktiv smenani olish
    const activeShift = await Shift.findOne({
      restaurantId,
      status: 'open'
    });

    const table = await Table.findOne({ _id: id, restaurantId })
      .populate({
        path: 'activeOrderId',
        populate: {
          path: 'waiterId',
          select: 'firstName lastName'
        }
      })
      .populate('assignedWaiterId', 'firstName lastName');

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    // MUHIM: Stolni aktiv smenaga qarab filterlash
    const tableObj = table.toObject();
    if (tableObj.activeOrderId && tableObj.status === 'occupied') {
      const order = tableObj.activeOrderId;
      // Aktiv smena yo'q bo'lsa - stolni bo'sh ko'rsatish
      if (!activeShift) {
        tableObj.status = 'free';
        tableObj.activeOrderId = null;
      }
      // Order boshqa smenaga tegishli bo'lsa - stolni bo'sh ko'rsatish
      else if (order.shiftId && order.shiftId.toString() !== activeShift._id.toString()) {
        tableObj.status = 'free';
        tableObj.activeOrderId = null;
      }
    }

    res.json({
      success: true,
      data: tableObj
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

    // Aktiv smenani olish
    const activeShift = await Shift.findOne({
      restaurantId,
      status: 'open'
    });

    const tables = await Table.find({ restaurantId })
      .populate('activeOrderId')
      .populate('assignedWaiterId', 'firstName lastName')
      .sort({ title: 1 });

    // MUHIM: Stollarni aktiv smenaga qarab filterlash
    const processedTables = tables.map(table => {
      const tableObj = table.toObject();
      if (tableObj.activeOrderId && tableObj.status === 'occupied') {
        const order = tableObj.activeOrderId;
        if (!activeShift) {
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        } else if (order.shiftId && order.shiftId.toString() !== activeShift._id.toString()) {
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        }
      }
      return tableObj;
    }).filter(table => table.status === mappedStatus);

    res.json({
      success: true,
      data: processedTables
    });
  } catch (error) {
    next(error);
  }
};

// Get tables assigned to current waiter
exports.getMyTables = async (req, res, next) => {
  try {
    const { restaurantId, id: staffId } = req.user;

    // Aktiv smenani olish
    const activeShift = await Shift.findOne({
      restaurantId,
      status: 'open'
    });

    const tables = await Table.find({
      restaurantId,
      assignedWaiterId: staffId
    })
      .populate({
        path: 'activeOrderId',
        populate: {
          path: 'waiterId',
          select: 'firstName lastName'
        }
      })
      .sort({ title: 1 });

    // MUHIM: Stollarni aktiv smenaga qarab filterlash
    const processedTables = tables.map(table => {
      const tableObj = table.toObject();
      if (tableObj.activeOrderId && tableObj.status === 'occupied') {
        const order = tableObj.activeOrderId;
        if (!activeShift) {
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        } else if (order.shiftId && order.shiftId.toString() !== activeShift._id.toString()) {
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        }
      }
      return tableObj;
    });

    res.json({
      success: true,
      data: processedTables
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
      assignedWaiterId,
      categoryId
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
      categoryId: categoryId || null,
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

    // Aktiv smenani olish
    const activeShift = await Shift.findOne({
      restaurantId,
      status: 'open'
    });

    const table = await Table.findOne({ _id: id, restaurantId });

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }

    let activeOrder = null;
    const tableObj = table.toObject();

    if (table.activeOrderId) {
      activeOrder = await Order.findById(table.activeOrderId)
        .populate('items.foodId', 'foodName price image')
        .populate('waiterId', 'firstName lastName');

      // MUHIM: Order aktiv smenaga tegishli emasligini tekshirish
      if (activeOrder) {
        // Aktiv smena yo'q bo'lsa - ko'rsatmaslik
        if (!activeShift) {
          activeOrder = null;
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        }
        // Order boshqa smenaga tegishli bo'lsa - ko'rsatmaslik
        else if (activeOrder.shiftId && activeOrder.shiftId.toString() !== activeShift._id.toString()) {
          activeOrder = null;
          tableObj.status = 'free';
          tableObj.activeOrderId = null;
        }
      }
    }

    res.json({
      success: true,
      data: {
        ...tableObj,
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

    // Aktiv smenani olish
    const activeShift = await Shift.findOne({
      restaurantId,
      status: 'open'
    });

    // Aktiv smenaning orderlari bilan band stollarni olish
    let occupiedTableIds = [];
    if (activeShift) {
      const activeOrders = await Order.find({
        restaurantId,
        shiftId: activeShift._id,
        status: { $nin: ['paid', 'cancelled', 'served'] },
        tableId: { $ne: null }
      }).select('tableId');
      occupiedTableIds = activeOrders.map(o => o.tableId.toString());
    }

    const tables = await Table.find({
      restaurantId,
      isDeleted: { $ne: true }
    });

    // Statistikani hisoblash
    const summaryMap = {};
    tables.forEach(table => {
      const location = table.location || 'indoor';
      if (!summaryMap[location]) {
        summaryMap[location] = { _id: location, total: 0, free: 0, occupied: 0, reserved: 0 };
      }
      summaryMap[location].total++;

      // Stolning haqiqiy statusini aniqlash
      let realStatus = table.status;
      if (table.status === 'occupied' && table.activeOrderId) {
        // Agar order aktiv smenaga tegishli bo'lmasa - free
        if (!occupiedTableIds.includes(table._id.toString())) {
          realStatus = 'free';
        }
      }

      if (realStatus === 'free') summaryMap[location].free++;
      else if (realStatus === 'occupied') summaryMap[location].occupied++;
      else if (realStatus === 'reserved') summaryMap[location].reserved++;
    });

    const summary = Object.values(summaryMap).sort((a, b) => a._id.localeCompare(b._id));

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

// === TZ 1.2, 6.1-6.2: Banket zali boshqaruvi ===

// Get all banquet halls
exports.getBanquetHalls = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;

    const banquetHalls = await Table.findBanquetHalls(restaurantId);

    res.json({
      success: true,
      data: banquetHalls
    });
  } catch (error) {
    next(error);
  }
};

// Split banquet hall into tables
exports.splitBanquetHall = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { tableCount } = req.body;
    const { restaurantId } = req.user;

    if (!tableCount || tableCount < 2 || tableCount > 20) {
      return res.status(400).json({
        success: false,
        message: 'Stollar soni 2 dan 20 gacha bo\'lishi kerak'
      });
    }

    const banquetHall = await Table.findOne({
      _id: id,
      restaurantId,
      isBanquetHall: true
    });

    if (!banquetHall) {
      return res.status(404).json({
        success: false,
        message: 'Banket zali topilmadi'
      });
    }

    const virtualTables = await banquetHall.splitIntoTables(tableCount);

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'banquet:split', {
      banquetHall,
      virtualTables
    });

    res.json({
      success: true,
      message: `Banket zali ${tableCount} ta stolga bo'lindi`,
      data: {
        banquetHall,
        virtualTables
      }
    });
  } catch (error) {
    next(error);
  }
};

// Merge banquet hall tables back
exports.mergeBanquetHall = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const banquetHall = await Table.findOne({
      _id: id,
      restaurantId,
      isBanquetHall: true
    });

    if (!banquetHall) {
      return res.status(404).json({
        success: false,
        message: 'Banket zali topilmadi'
      });
    }

    await banquetHall.mergeTables();

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'banquet:merged', {
      banquetHall
    });

    res.json({
      success: true,
      message: 'Banket zali birlashtirildi',
      data: banquetHall
    });
  } catch (error) {
    // Check for specific error messages
    if (error.message && error.message.includes('faol buyurtmalar')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// Toggle banquet mode (normal/split pricing)
exports.toggleBanquetMode = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { mode } = req.body;
    const { restaurantId } = req.user;

    if (!['normal', 'split'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Mode "normal" yoki "split" bo\'lishi kerak'
      });
    }

    const banquetHall = await Table.findOne({
      _id: id,
      restaurantId,
      isBanquetHall: true
    });

    if (!banquetHall) {
      return res.status(404).json({
        success: false,
        message: 'Banket zali topilmadi'
      });
    }

    banquetHall.banquetMode = mode;
    await banquetHall.save();

    socketService.emitToRestaurant(restaurantId, 'banquet:mode-changed', {
      banquetHall,
      mode
    });

    res.json({
      success: true,
      message: `Banket rejimi ${mode === 'normal' ? 'soatlik to\'lov' : 'stollar + 10% xizmat haqi'}ga o'zgartirildi`,
      data: banquetHall
    });
  } catch (error) {
    next(error);
  }
};
