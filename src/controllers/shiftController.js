const { Shift, Order } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const socketService = require('../services/socketService');

/**
 * Smena eventlarini yuborish
 */
const emitShiftEvent = (restaurantId, eventType, data) => {
  // Barcha clientlarga yuborish
  socketService.emitToRestaurant(restaurantId, eventType, data);

  // Role-specific yuborish
  socketService.emitToRole(restaurantId, 'admin', eventType, data);
  socketService.emitToRole(restaurantId, 'cashier', eventType, data);
  socketService.emitToRole(restaurantId, 'cook', eventType, data);
  socketService.emitToRole(restaurantId, 'waiter', eventType, data);
};

/**
 * Aktiv smenani olish
 * GET /api/shifts/active
 */
const getActiveShift = asyncHandler(async (req, res) => {
  const { restaurantId } = req.user;

  const shift = await Shift.getActiveShift(restaurantId);

  if (!shift) {
    return res.json({
      success: true,
      data: null,
      message: 'Aktiv smena yo\'q'
    });
  }

  // Ochgan odamni populate qilish
  await shift.populate('openedBy', 'firstName lastName');

  // Hozirgi statistikani hisoblash
  await shift.calculateStats();

  res.json({
    success: true,
    data: shift
  });
});

/**
 * Yangi smena ochish
 * POST /api/shifts/open
 */
const openShift = asyncHandler(async (req, res) => {
  const { restaurantId, id: userId } = req.user;
  const { openingCash = 0, openingNotes = '' } = req.body;

  // Aktiv smena borligini tekshirish
  const activeShift = await Shift.getActiveShift(restaurantId);
  if (activeShift) {
    throw new AppError(
      'Aktiv smena mavjud. Avval uni yoping.',
      400,
      'ACTIVE_SHIFT_EXISTS'
    );
  }

  // Keyingi smena raqamini olish
  const shiftNumber = await Shift.getNextShiftNumber(restaurantId);

  // Yangi smena yaratish
  const shift = new Shift({
    restaurantId,
    shiftNumber,
    openedBy: userId,
    openingCash: parseFloat(openingCash) || 0,
    openingNotes,
    status: 'active'
  });

  await shift.save();
  await shift.populate('openedBy', 'firstName lastName');

  // O'tkazilmagan (shiftId = null) buyurtmalarni yangi smenaga biriktirish
  const orphanOrders = await Order.find({
    restaurantId,
    shiftId: null,
    isPaid: false,
    status: { $nin: ['paid', 'cancelled'] }
  });

  if (orphanOrders.length > 0) {
    const orphanIds = [];
    for (const order of orphanOrders) {
      order.shiftId = shift._id;
      order.transferredToShiftAt = new Date();
      await order.save();
      orphanIds.push(order._id);
    }
    shift.transferredOrderIds = orphanIds;
    await shift.save();
  }

  // Real-time event yuborish
  emitShiftEvent(restaurantId.toString(), 'shift:opened', {
    shift,
    message: `Smena #${shiftNumber} ochildi`,
    transferredOrders: orphanOrders.length
  });

  res.status(201).json({
    success: true,
    data: shift,
    transferredOrders: orphanOrders.length,
    message: `Smena #${shiftNumber} muvaffaqiyatli ochildi`
  });
});

/**
 * Smenani yopish
 * POST /api/shifts/:id/close
 */
const closeShift = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId, id: userId } = req.user;
  const { closingCash, closingNotes = '' } = req.body;

  if (closingCash === undefined || closingCash === null) {
    throw new AppError('Yopish summasi kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  const shift = await Shift.findOne({
    _id: id,
    restaurantId,
    status: 'active'
  });

  if (!shift) {
    throw new AppError('Aktiv smena topilmadi', 404, 'NOT_FOUND');
  }

  // To'lanmagan buyurtmalarni shiftId = null qilib qo'yish (yangi smenaga o'tishi uchun)
  const unpaidOrders = await Order.find({
    shiftId: shift._id,
    isPaid: false,
    status: { $nin: ['paid', 'cancelled'] }
  });

  const transferredOrderIds = [];
  for (const order of unpaidOrders) {
    order.shiftId = null; // Yangi smena ochilganda avtomatik ulanadi
    order.transferredFromShiftId = shift._id;
    await order.save();
    transferredOrderIds.push(order._id);
  }

  // Smenani yopish
  await shift.closeShift(userId, parseFloat(closingCash), closingNotes);
  await shift.populate('openedBy closedBy', 'firstName lastName');

  // Real-time event yuborish
  emitShiftEvent(restaurantId.toString(), 'shift:closed', {
    shift,
    message: `Smena #${shift.shiftNumber} yopildi`,
    transferredOrders: transferredOrderIds.length
  });

  res.json({
    success: true,
    data: shift,
    transferredOrders: transferredOrderIds.length,
    message: `Smena #${shift.shiftNumber} muvaffaqiyatli yopildi`
  });
});

/**
 * Smena tarixini olish
 * GET /api/shifts/history
 */
const getShiftHistory = asyncHandler(async (req, res) => {
  const { restaurantId } = req.user;
  const {
    page = 1,
    limit = 20,
    startDate,
    endDate,
    status
  } = req.query;

  const filter = { restaurantId };

  if (status) filter.status = status;

  if (startDate || endDate) {
    filter.openedAt = {};
    if (startDate) filter.openedAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filter.openedAt.$lte = end;
    }
  }

  const shifts = await Shift.find(filter)
    .populate('openedBy closedBy', 'firstName lastName')
    .sort({ openedAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));

  const total = await Shift.countDocuments(filter);

  res.json({
    success: true,
    data: shifts,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit))
    }
  });
});

/**
 * Smena detallari
 * GET /api/shifts/:id
 */
const getShiftById = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId } = req.user;

  const shift = await Shift.findOne({ _id: id, restaurantId })
    .populate('openedBy closedBy', 'firstName lastName');

  if (!shift) {
    throw new AppError('Smena topilmadi', 404, 'NOT_FOUND');
  }

  // Statistikani yangilash
  await shift.calculateStats();

  res.json({
    success: true,
    data: shift
  });
});

/**
 * Smena hisoboti (batafsil)
 * GET /api/shifts/:id/report
 */
const getShiftReport = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId } = req.user;

  const shift = await Shift.findOne({ _id: id, restaurantId })
    .populate('openedBy closedBy', 'firstName lastName');

  if (!shift) {
    throw new AppError('Smena topilmadi', 404, 'NOT_FOUND');
  }

  // Buyurtmalarni olish
  const orders = await Order.find({
    shiftId: shift._id
  })
    .populate('waiterId', 'firstName lastName')
    .populate('tableId', 'title tableNumber')
    .sort({ createdAt: -1 });

  // Ofitsiantlar statistikasi
  const waiterStats = {};
  for (const order of orders) {
    if (order.waiterId && order.isPaid) {
      const wId = order.waiterId._id.toString();
      if (!waiterStats[wId]) {
        waiterStats[wId] = {
          waiterId: order.waiterId._id,
          name: `${order.waiterId.firstName} ${order.waiterId.lastName}`,
          orders: 0,
          revenue: 0,
          serviceCharge: 0
        };
      }
      waiterStats[wId].orders++;
      waiterStats[wId].revenue += order.grandTotal || 0;
      waiterStats[wId].serviceCharge += order.serviceCharge || 0;
    }
  }

  // Top taomlar
  const foodStats = {};
  for (const order of orders) {
    for (const item of order.items) {
      if (!item.isDeleted && item.status !== 'cancelled') {
        const key = item.foodName;
        if (!foodStats[key]) {
          foodStats[key] = {
            name: item.foodName,
            quantity: 0,
            revenue: 0
          };
        }
        foodStats[key].quantity += item.quantity;
        foodStats[key].revenue += item.price * item.quantity;
      }
    }
  }

  const topFoods = Object.values(foodStats)
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 10);

  // Soatlik statistika
  const hourlyStats = {};
  for (const order of orders) {
    if (order.isPaid) {
      const hour = new Date(order.createdAt).getHours();
      if (!hourlyStats[hour]) {
        hourlyStats[hour] = { orders: 0, revenue: 0 };
      }
      hourlyStats[hour].orders++;
      hourlyStats[hour].revenue += order.grandTotal || 0;
    }
  }

  // To'lov turlari statistikasi
  const paymentTypeStats = {
    cash: { count: 0, amount: 0 },
    card: { count: 0, amount: 0 },
    click: { count: 0, amount: 0 },
    mixed: { count: 0, amount: 0 }
  };

  for (const order of orders) {
    if (order.isPaid && order.paymentType) {
      if (paymentTypeStats[order.paymentType]) {
        paymentTypeStats[order.paymentType].count++;
        paymentTypeStats[order.paymentType].amount += order.grandTotal || 0;
      }
    }
  }

  // Statistikani yangilash
  await shift.calculateStats();

  res.json({
    success: true,
    data: {
      shift,
      orders,
      waiterStats: Object.values(waiterStats).sort((a, b) => b.revenue - a.revenue),
      topFoods,
      hourlyStats,
      paymentTypeStats
    }
  });
});

/**
 * Smena izohlarini yangilash
 * PATCH /api/shifts/:id/notes
 */
const updateShiftNotes = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId } = req.user;
  const { openingNotes, closingNotes } = req.body;

  const shift = await Shift.findOne({ _id: id, restaurantId });

  if (!shift) {
    throw new AppError('Smena topilmadi', 404, 'NOT_FOUND');
  }

  if (openingNotes !== undefined) shift.openingNotes = openingNotes;
  if (closingNotes !== undefined) shift.closingNotes = closingNotes;

  await shift.save();

  res.json({
    success: true,
    data: shift
  });
});

/**
 * Smena bo'yicha buyurtmalarni olish
 * GET /api/shifts/:id/orders
 */
const getShiftOrders = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId } = req.user;
  const { isPaid, status, page = 1, limit = 50 } = req.query;

  const shift = await Shift.findOne({ _id: id, restaurantId });

  if (!shift) {
    throw new AppError('Smena topilmadi', 404, 'NOT_FOUND');
  }

  const filter = { shiftId: shift._id };

  if (isPaid !== undefined) filter.isPaid = isPaid === 'true';
  if (status) filter.status = status;

  const orders = await Order.find(filter)
    .populate('waiterId', 'firstName lastName')
    .populate('tableId', 'title tableNumber')
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));

  const total = await Order.countDocuments(filter);

  res.json({
    success: true,
    data: orders,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      totalPages: Math.ceil(total / parseInt(limit))
    }
  });
});

module.exports = {
  getActiveShift,
  openShift,
  closeShift,
  getShiftHistory,
  getShiftById,
  getShiftReport,
  updateShiftNotes,
  getShiftOrders
};
