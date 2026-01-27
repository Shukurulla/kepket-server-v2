const { Order, Table, Food, Notification, Shift } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { emitOrderEvent, ORDER_EVENTS, emitToUser, emitToRole } = require('../events/eventEmitter');
const socketService = require('../services/socketService');
const mongoose = require('mongoose');

/**
 * Aktiv smenani tekshirish helper
 */
const checkActiveShift = async (restaurantId) => {
  const activeShift = await Shift.getActiveShift(restaurantId);
  if (!activeShift) {
    throw new AppError(
      'Aktiv smena yo\'q. Buyurtma yaratish uchun admin smenani ochishi kerak.',
      400,
      'NO_ACTIVE_SHIFT'
    );
  }
  return activeShift;
};

/**
 * Get orders with filters
 * GET /api/orders
 */
const getOrders = asyncHandler(async (req, res) => {
  const { restaurantId, role } = req.user;
  const {
    status,
    waiterId,
    tableId,
    isPaid,
    date,
    startDate,
    endDate,
    startTime,
    endTime,
    shiftId,
    allShifts, // Admin uchun barcha smenalardan ko'rish imkoniyati
    page = 1,
    limit = 1000
  } = req.query;

  const filter = { restaurantId };

  // Apply filters
  if (status) filter.status = status;
  if (waiterId) filter.waiterId = waiterId;
  if (tableId) filter.tableId = tableId;
  if (isPaid !== undefined) {
    filter.isPaid = isPaid === 'true';
    // To'langan orderlarni so'raganda bekor qilinganlarni chiqarmaslik
    if (isPaid === 'true') {
      filter.status = { $ne: 'cancelled' };
    }
  }

  // Smena filteri
  // 1. Agar shiftId berilgan bo'lsa - shu smenadagi buyurtmalar
  // 2. Agar waiterId berilgan bo'lsa (waiter app) - DOIM aktiv smena bo'yicha filter
  // 3. Agar date/startDate berilgan bo'lsa va waiterId yo'q (admin) - sana bo'yicha filter (smena filter yo'q)
  // 4. Aks holda (va allShifts=true bo'lmasa) - avtomatik aktiv smena buyurtmalari
  if (shiftId) {
    filter.shiftId = shiftId;
  } else if (waiterId || (!date && !startDate && !endDate && allShifts !== 'true')) {
    // Waiter app uchun DOIM aktiv smena bo'yicha filter qilish
    // Admin uchun esa faqat date berilmaganda
    const activeShift = await Shift.getActiveShift(restaurantId);
    if (activeShift) {
      filter.shiftId = activeShift._id;
    } else {
      // MUHIM: Aktiv smena yo'q - hech qanday buyurtma ko'rsatmaslik
      // Mavjud bo'lmagan ObjectId bilan filter qilish orqali bo'sh natija qaytarish
      filter.shiftId = new mongoose.Types.ObjectId();
    }
  }

  // Date filter with time support (Tashkent timezone UTC+5)
  if (startDate || endDate || date) {
    const dateStr = startDate || date || new Date().toISOString().split('T')[0];
    const endDateStr = endDate || date || new Date().toISOString().split('T')[0];

    // Toshkent vaqtini UTC ga aylantirish funksiyasi
    const createDateInTashkent = (dateString, hours = 0, minutes = 0, seconds = 0, ms = 0) => {
      const d = new Date(dateString + 'T00:00:00.000Z');
      d.setUTCHours(hours - 5, minutes, seconds, ms); // UTC+5 dan UTC ga
      return d;
    };

    let start, end;

    if (startTime) {
      const [hours, minutes] = startTime.split(':').map(Number);
      start = createDateInTashkent(dateStr, hours, minutes, 0, 0);
    } else {
      start = createDateInTashkent(dateStr, 0, 0, 0, 0);
    }

    if (endTime) {
      const [hours, minutes] = endTime.split(':').map(Number);
      end = createDateInTashkent(endDateStr, hours, minutes, 59, 999);
    } else {
      end = createDateInTashkent(endDateStr, 23, 59, 59, 999);
    }

    filter.createdAt = { $gte: start, $lte: end };
  }

  const rawOrders = await Order.find(filter)
    .populate('waiterId', 'firstName lastName')
    .populate('tableId', 'title tableNumber hasHourlyCharge hourlyChargeAmount')
    .sort({ createdAt: -1 })
    .skip((parseInt(page) - 1) * parseInt(limit))
    .limit(parseInt(limit));

  // MUHIM: Qo'shimcha filter - shiftId bo'lmagan orderlarni chiqarib tashlash
  const orders = rawOrders.filter(order => {
    return order.shiftId && order.shiftId.toString().trim() !== '';
  });

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

/**
 * Get today's orders (aktiv smena bo'yicha)
 * GET /api/orders/today
 *
 * Query params:
 * - shiftId: Aniq smena ID si (frontend dan keladi)
 * - allShifts: true bo'lsa barcha smenalardan ko'rsatadi
 * - isPaid: true/false
 */
const getTodayOrders = asyncHandler(async (req, res) => {
  const { restaurantId } = req.user;
  const { isPaid, allShifts, shiftId } = req.query;

  const filter = { restaurantId };

  // Smena filteri - MUHIM: frontend dan kelgan shiftId ga ustuvorlik
  if (shiftId && shiftId.trim() !== '') {
    // Frontend aniq shiftId yuborgan - shu smenani ko'rsatish
    // MUHIM: ObjectId ga convert qilish va faqat aniq mos keladiganlarni olish
    try {
      const shiftObjectId = new mongoose.Types.ObjectId(shiftId);
      filter.shiftId = shiftObjectId;
    } catch (err) {
      // Invalid ObjectId - bo'sh qaytarish
      return res.json({
        success: true,
        data: { orders: [] }
      });
    }
  } else if (allShifts !== 'true') {
    // ShiftId berilmagan va allShifts=true emas - aktiv smenani aniqlash
    const activeShift = await Shift.getActiveShift(restaurantId);
    if (activeShift) {
      // MUHIM: faqat aniq shu smena orderlarini olish
      filter.shiftId = activeShift._id;
    } else {
      // Aktiv smena yo'q - bo'sh qaytarish (hech qanday order ko'rsatilmaydi)
      return res.json({
        success: true,
        data: { orders: [] }
      });
    }
  } else {
    // allShifts=true - bugungi kunni ko'rsatish
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    filter.createdAt = { $gte: startOfDay };
    // MUHIM: faqat shiftId mavjud bo'lgan orderlarni olish
    filter.shiftId = { $exists: true, $ne: null };
  }

  if (isPaid !== undefined) filter.isPaid = isPaid === 'true';

  const orders = await Order.find(filter)
    .populate('waiterId', 'firstName lastName')
    .populate('tableId', 'title tableNumber hasHourlyCharge hourlyChargeAmount')
    .sort({ createdAt: -1 });

  // MUHIM: Qo'shimcha filter - shiftId bo'lmagan orderlarni chiqarib tashlash
  const filteredOrders = orders.filter(order => {
    // shiftId mavjud va null/undefined emas bo'lishi kerak
    return order.shiftId && order.shiftId.toString().trim() !== '';
  });

  res.json({
    success: true,
    data: { orders: filteredOrders }
  });
});

/**
 * Get daily summary
 * GET /api/orders/summary
 */
const getDailySummary = asyncHandler(async (req, res) => {
  const { restaurantId } = req.user;
  const { date } = req.query;

  const summary = await Order.getDailySummary(restaurantId, date ? new Date(date) : new Date());

  // Add active orders count
  const activeOrders = await Order.countDocuments({
    restaurantId,
    isPaid: false,
    status: { $nin: ['paid', 'cancelled'] }
  });

  res.json({
    success: true,
    data: {
      ...summary,
      activeOrders
    }
  });
});

/**
 * Get single order
 * GET /api/orders/:id
 */
const getOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId })
    .populate('waiterId', 'firstName lastName phone')
    .populate('tableId', 'title tableNumber');

  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  res.json({
    success: true,
    data: order
  });
});

/**
 * Create order or add items to existing unpaid order
 * POST /api/orders
 */
const createOrder = asyncHandler(async (req, res) => {
  const { restaurantId, id: userId, role, fullName } = req.user;
  const {
    tableId,
    tableName,
    tableNumber,
    items,
    orderType = 'dine-in',
    waiterId,
    waiterName,
    comment,
    surcharge = 0,
    forceNewOrder = false // Yangi order yaratishni majburlash uchun
  } = req.body;

  // Aktiv smenani tekshirish
  const activeShift = await checkActiveShift(restaurantId);

  // Validate items
  if (!items || items.length === 0) {
    throw new AppError('Kamida bitta taom kerak', 400, 'VALIDATION_ERROR');
  }

  // === Stop-list va limit tekshiruvi ===
  // Avval bir xil taomlarning miqdorini agregatsiya qilish
  const foodQuantityMap = new Map(); // foodId -> { quantity, item }
  for (const item of items) {
    if (item.foodId) {
      const foodIdStr = item.foodId.toString();
      const qty = item.quantity || 1;
      if (foodQuantityMap.has(foodIdStr)) {
        foodQuantityMap.get(foodIdStr).quantity += qty;
      } else {
        foodQuantityMap.set(foodIdStr, { quantity: qty, item });
      }
    }
  }

  const unavailableFoods = [];
  for (const [foodIdStr, { quantity: totalQty }] of foodQuantityMap) {
    const food = await Food.findById(foodIdStr);
    if (food) {
      // Kunlik countni yangilash (yangi kun bo'lsa reset va saqlash)
      await food.checkAndResetDailyCount(true);

      // Stop-listda bo'lsa
      if (food.isInStopList) {
        unavailableFoods.push({
          foodId: food._id,
          foodName: food.foodName,
          reason: food.stopListReason || food.autoStopReason || 'Stop-listda'
        });
        continue;
      }

      // Avto stop-list: limitga yetgan yoki yetib qolsa
      if (food.autoStopListEnabled && food.dailyOrderLimit > 0) {
        const remaining = food.dailyOrderLimit - food.dailyOrderCount;

        if (remaining <= 0) {
          unavailableFoods.push({
            foodId: food._id,
            foodName: food.foodName,
            reason: `Kunlik limit tugagan (${food.dailyOrderLimit} ta)`
          });
        } else if (totalQty > remaining) {
          unavailableFoods.push({
            foodId: food._id,
            foodName: food.foodName,
            reason: `Faqat ${remaining} ta qolgan (${totalQty} ta so'ralgan)`
          });
        }
      }

      // Taom mavjud emasligini tekshirish
      if (food.isAvailable === false) {
        unavailableFoods.push({
          foodId: food._id,
          foodName: food.foodName,
          reason: 'Taom mavjud emas'
        });
      }
    }
  }

  // Agar mavjud bo'lmagan taomlar bo'lsa, xatolik qaytarish
  if (unavailableFoods.length > 0) {
    throw new AppError(
      `Quyidagi taomlar buyurtma qilib bo'lmaydi: ${unavailableFoods.map(f => f.foodName).join(', ')}`,
      400,
      'FOOD_UNAVAILABLE',
      { unavailableFoods }
    );
  }

  // Prepare items with food details (TZ 3.2: kim qo'shganini saqlash)
  const orderItems = await Promise.all(items.map(async (item) => {
    const food = await Food.findById(item.foodId);
    return {
      foodId: item.foodId,
      foodName: food ? food.foodName || food.name : item.foodName,
      categoryId: food ? food.categoryId : item.categoryId,
      quantity: item.quantity || 1,
      price: food ? food.price : item.price,
      addedBy: userId,
      addedByName: fullName
    };
  }));

  let order;
  let isNewOrder = false;

  // Agar tableId bo'lsa va forceNewOrder false bo'lsa, mavjud to'lanmagan orderni qidirish
  if (tableId && !forceNewOrder && orderType === 'dine-in') {
    // Avval table'ning activeOrderId sini tekshirish - eng ishonchli usul
    const table = await Table.findById(tableId);
    let existingOrder = null;

    if (table && table.activeOrderId) {
      // Table'da aktiv order bor - uni olish
      existingOrder = await Order.findOne({
        _id: table.activeOrderId,
        restaurantId,
        isPaid: false,
        isDeleted: { $ne: true },
        status: { $nin: ['paid', 'cancelled'] }
      });
    }

    // Agar table'da activeOrderId yo'q bo'lsa, lekin to'lanmagan order bo'lishi mumkin
    if (!existingOrder) {
      existingOrder = await Order.findOne({
        restaurantId,
        tableId,
        isPaid: false,
        isDeleted: { $ne: true },
        status: { $nin: ['paid', 'cancelled'] }
      }).sort({ createdAt: -1 }); // Eng oxirgi orderni olish
    }

    if (existingOrder) {
      // Mavjud orderga itemlarni qo'shish
      existingOrder.items.push(...orderItems);

      // Agar yangi comment bo'lsa, qo'shish
      if (comment) {
        existingOrder.comment = existingOrder.comment
          ? `${existingOrder.comment}\n${comment}`
          : comment;
      }

      await existingOrder.save();
      order = existingOrder;

      // Table'ning activeOrderId sini yangilash (agar yo'q bo'lsa)
      if (table && !table.activeOrderId) {
        await Table.findByIdAndUpdate(tableId, {
          status: 'occupied',
          activeOrderId: order._id
        });
      }

      // Populate for response
      await order.populate('tableId', 'title tableNumber number');
      await order.populate('waiterId', 'firstName lastName');
    }
  }

  // Agar mavjud order topilmasa, yangi order yaratish
  if (!order) {
    isNewOrder = true;
    const orderNumber = await Order.getNextOrderNumber(restaurantId);

    order = new Order({
      restaurantId,
      shiftId: activeShift._id,
      orderNumber,
      orderType,
      tableId,
      tableName,
      tableNumber,
      items: orderItems,
      waiterId: waiterId || (role === 'waiter' ? userId : null),
      waiterName: waiterName || (role === 'waiter' ? fullName : null),
      waiterApproved: role === 'waiter' || role === 'admin',
      approvedAt: role === 'waiter' || role === 'admin' ? new Date() : null,
      source: role === 'admin' ? 'admin' : 'waiter',
      comment,
      surcharge
    });

    await order.save();

    // Populate for response
    await order.populate('tableId', 'title tableNumber number');
    await order.populate('waiterId', 'firstName lastName');

    // Update table status (faqat yangi order uchun)
    if (tableId) {
      await Table.findByIdAndUpdate(tableId, {
        status: 'occupied',
        activeOrderId: order._id
      });
    }
  }

  // === Avto stop-list: Food kunlik order countni increment qilish ===
  const autoStoppedFoods = [];
  try {
    for (const item of orderItems) {
      if (item.foodId) {
        const food = await Food.findById(item.foodId);
        if (food) {
          const result = await food.incrementDailyOrderCount(item.quantity || 1);
          if (result.autoStopped) {
            autoStoppedFoods.push({
              foodId: food._id,
              foodName: food.foodName,
              reason: food.autoStopReason
            });
          }
        }
      }
    }

    // Agar biror ovqat avto stop-listga tushgan bo'lsa, socket orqali xabar berish
    if (autoStoppedFoods.length > 0) {
      socketService.emitToRestaurant(restaurantId.toString(), 'foods:auto_stopped', {
        foods: autoStoppedFoods,
        message: `${autoStoppedFoods.length} ta ovqat limitga yetgani uchun stop-listga tushdi`
      });
    }
  } catch (err) {
    console.error('Error updating food daily order counts:', err);
  }

  // Emit real-time event
  if (isNewOrder) {
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.CREATED, { order });
  } else {
    // Mavjud orderga item qo'shilganda
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, { order, itemsAdded: orderItems });
  }

  // Cook uchun kitchen_orders_updated yuborish (including ready items)
  try {
    const rawKitchenOrders = await Order.find({
      restaurantId,
      shiftId: activeShift._id, // Faqat joriy smena buyurtmalari
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    }).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Transform for cook-web format
    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .map((i, originalIdx) => ({ i, originalIdx }))
        .filter(({ i }) => ['pending', 'preparing', 'ready'].includes(i.status))
        .map(({ i, originalIdx }) => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName,
          requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
          categoryId: i.foodId?.categoryId?.toString() || null,
          originalIndex: originalIdx
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
        orderType: o.orderType || 'dine-in',
        saboyNumber: o.saboyNumber,
        tableId: o.tableId,
        tableName: o.orderType === 'saboy'
          ? `Saboy #${o.saboyNumber || o.orderNumber}`
          : (o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`),
        tableNumber: o.tableId?.number || o.tableNumber,
        waiterId: o.waiterId,
        waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
        items,
        status: o.status,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId
      };
    }).filter(o => o.items.length > 0);

    // Yangi qo'shilgan itemlarni formatlash
    const formattedNewItems = orderItems.map((i, idx) => ({
      ...i,
      kitchenStatus: 'pending',
      originalIndex: order.items.length - orderItems.length + idx
    }));

    // Admin uchun barcha itemlar
    socketService.emitToRole(restaurantId.toString(), 'admin', 'new_kitchen_order', {
      order: order,
      allOrders: kitchenOrders,
      isNewOrder: isNewOrder,
      itemsAddedToExisting: !isNewOrder,
      newItems: formattedNewItems
    });

    // Har bir cook uchun filter qilingan
    if (isNewOrder) {
      // Yangi order - barcha itemlarni yuborish
      await socketService.emitFilteredNewKitchenOrder(restaurantId.toString(), order, kitchenOrders);
    } else {
      // Mavjud orderga item qo'shildi - faqat yangi itemlarni yuborish
      await socketService.emitFilteredNewKitchenOrderForAddedItems(restaurantId.toString(), order, kitchenOrders, formattedNewItems);
    }
    await socketService.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
  } catch (err) {
    console.error('Error sending kitchen orders:', err);
  }

  // Agar buyurtma waiter tasdiqlashini kutayotgan bo'lsa, waiterga xabar berish
  if (!order.waiterApproved && order.waiterId) {
    const tableTitle = order.tableId?.title || order.tableName || `Stol ${order.tableNumber}`;

    // Create notification for waiter
    try {
      await Notification.create({
        restaurantId,
        staffId: order.waiterId,
        type: 'new_order',
        title: 'Yangi buyurtma!',
        message: `${tableTitle} - yangi buyurtma tasdiqlang`,
        orderId: order._id,
        tableId: order.tableId?._id || tableId,
        priority: 'high'
      });
    } catch (err) {
      console.error('Error creating notification:', err);
    }

    // Emit pending_order_approval to waiter (Flutter app)
    socketService.emitToUser(order.waiterId.toString(), 'pending_order_approval', {
      order,
      orderId: order._id,
      tableName: tableTitle,
      tableNumber: order.tableNumber,
      message: `${tableTitle} - yangi buyurtma tasdiqlang`
    });
  }

  res.status(201).json({
    success: true,
    data: order,
    isNewOrder: isNewOrder,
    message: isNewOrder
      ? 'Yangi buyurtma yaratildi'
      : 'Taomlar mavjud buyurtmaga qo\'shildi'
  });
});

/**
 * Update order
 * PATCH /api/orders/:id
 */
const updateOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId } = req.user;
  const updates = req.body;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  // Apply updates
  Object.keys(updates).forEach(key => {
    if (key !== '_id' && key !== 'restaurantId') {
      order[key] = updates[key];
    }
  });

  await order.save();

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'update'
  });

  res.json({
    success: true,
    data: order
  });
});

/**
 * Delete order (soft delete)
 * DELETE /api/orders/:id
 */
const deleteOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId, id: userId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  // Free the table
  if (order.tableId) {
    await Table.findByIdAndUpdate(order.tableId, {
      status: 'free',
      activeOrderId: null
    });
  }

  // Soft delete
  await order.softDelete(userId);

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.DELETED, { orderId: id });

  // Cook uchun kitchen_orders_updated yuborish
  try {
    // Aktiv smenani olish
    const activeShift = await Shift.getActiveShift(restaurantId);

    // Kitchen orders filter
    const kitchenFilter = {
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    };
    // MUHIM: Aktiv smena yo'q bo'lsa, bo'sh data yuborish va query qilmaslik
    if (!activeShift) {
      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), [], 'kitchen_orders_updated');
    } else {
      kitchenFilter.shiftId = activeShift._id;

      const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
        .populate('tableId', 'title tableNumber number')
        .populate('waiterId', 'firstName lastName')
        .sort({ createdAt: -1 });

      const kitchenOrders = rawKitchenOrders.map(o => {
        const items = o.items
          .map((i, originalIdx) => ({ i, originalIdx }))
          .filter(({ i }) => ['pending', 'preparing', 'ready'].includes(i.status) && !i.isDeleted)
          .map(({ i, originalIdx }) => ({
            ...i.toObject(),
            kitchenStatus: i.status,
            name: i.foodId?.name || i.foodName,
            requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
            categoryId: i.foodId?.categoryId?.toString() || null,
            originalIndex: originalIdx
          }));
        return {
          _id: o._id,
          orderId: o._id,
          orderNumber: o.orderNumber,
          orderType: o.orderType || 'dine-in',
          saboyNumber: o.saboyNumber,
          tableId: o.tableId,
          tableName: o.orderType === 'saboy'
            ? `Saboy #${o.saboyNumber || o.orderNumber}`
            : (o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`),
          tableNumber: o.tableId?.number || o.tableNumber,
          waiterId: o.waiterId,
          waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
          items,
          status: o.status,
          createdAt: o.createdAt,
          restaurantId: o.restaurantId
        };
      }).filter(o => o.items.length > 0);

      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
    }
  } catch (err) {
    console.error('Error sending kitchen orders after delete:', err);
  }

  res.json({
    success: true,
    message: 'Order o\'chirildi'
  });
});

/**
 * Add items to order
 * POST /api/orders/:id/items
 */
const addItems = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId, id: userId, fullName } = req.user;
  const { items } = req.body;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  // Yangi itemlarni tayyorlash (categoryId bilan)
  const orderItems = [];
  for (const item of items) {
    const food = await Food.findById(item.foodId);
    const newItem = {
      foodId: item.foodId,
      foodName: food ? food.foodName : item.foodName,
      categoryId: food ? food.categoryId : item.categoryId,
      quantity: item.quantity || 1,
      price: food ? food.price : item.price,
      addedBy: userId,
      addedByName: fullName
    };
    order.addItem(newItem);
    orderItems.push(newItem);
  }

  // Yangi item qo'shilganda, order statusi 'ready' yoki 'served' bo'lsa 'preparing' ga qaytarish
  if (['ready', 'served'].includes(order.status)) {
    order.status = 'preparing';
  }

  await order.save();

  // Populate for proper data
  await order.populate('tableId', 'title tableNumber number');
  await order.populate('waiterId', 'firstName lastName');

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'items_added',
    newItems: orderItems
  });

  // Cook uchun kitchen_orders_updated yuborish (kategoriya bo'yicha filter qilingan)
  try {
    // Aktiv smenani olish
    const activeShift = await Shift.getActiveShift(restaurantId);

    // Kitchen orders filter
    const kitchenFilter = {
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready', 'served', 'paid'] },
      'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] }
    };
    // MUHIM: Aktiv smena yo'q bo'lsa, bo'sh data yuborish va query qilmaslik
    if (!activeShift) {
      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), [], 'kitchen_orders_updated');
    } else {
      kitchenFilter.shiftId = activeShift._id;

      const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
        .populate('tableId', 'title tableNumber number')
        .populate('waiterId', 'firstName lastName')
        .sort({ createdAt: -1 });

      // Transform for cook-web format
      const kitchenOrders = rawKitchenOrders.map(o => {
        const items = o.items
          .map((i, originalIdx) => ({ i, originalIdx }))
          .filter(({ i }) => ['pending', 'preparing', 'ready', 'served'].includes(i.status) && !i.isDeleted)
          .map(({ i, originalIdx }) => ({
            ...i.toObject(),
            kitchenStatus: i.status,
            name: i.foodId?.name || i.foodName,
            requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
            categoryId: i.foodId?.categoryId?.toString() || i.categoryId?.toString() || null,
            originalIndex: originalIdx
          }));
        return {
          _id: o._id,
          orderId: o._id,
          orderNumber: o.orderNumber,
          orderType: o.orderType || 'dine-in',
          saboyNumber: o.saboyNumber,
          tableId: o.tableId,
          tableName: o.orderType === 'saboy'
            ? `Saboy #${o.saboyNumber || o.orderNumber}`
            : (o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`),
          tableNumber: o.tableId?.number || o.tableNumber,
          waiterId: o.waiterId,
          waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
          items,
          status: o.status,
          createdAt: o.createdAt,
          restaurantId: o.restaurantId
        };
      }).filter(o => o.items.length > 0);

      // Yangi qo'shilgan itemlarni formatlash (categoryId bilan!)
      const formattedNewItems = orderItems.map((item, idx) => ({
        ...item,
        kitchenStatus: 'pending',
        categoryId: item.categoryId?.toString() || null,
        originalIndex: order.items.length - orderItems.length + idx
      }));

      // Admin uchun barcha itemlar
      socketService.emitToRole(restaurantId.toString(), 'admin', 'new_kitchen_order', {
        order: order,
        allOrders: kitchenOrders,
        isNewOrder: false,
        itemsAddedToExisting: true,
        newItems: formattedNewItems
      });

      // Har bir cook uchun KATEGORIYA BO'YICHA filter qilingan
      await socketService.emitFilteredNewKitchenOrderForAddedItems(restaurantId.toString(), order, kitchenOrders, formattedNewItems);
      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
    }
  } catch (err) {
    console.error('Error sending kitchen orders after addItems:', err);
  }

  res.json({
    success: true,
    data: order
  });
});

/**
 * Delete item from order
 * DELETE /api/orders/:id/items/:itemId
 */
const deleteItem = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { restaurantId, id: userId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  const item = order.items.id(itemId);
  if (!item) {
    throw new AppError('Item topilmadi', 404, 'NOT_FOUND');
  }

  order.removeItem(itemId, userId);
  await order.save();

  // Check if order was also deleted (no items left)
  const orderDeleted = order.isDeleted;

  // Populate order data
  await order.populate('tableId', 'number floor title tableNumber');
  await order.populate('waiterId', 'firstName lastName phone');
  await order.populate('items.foodId', 'name price image categoryId requireDoubleConfirmation');

  if (orderDeleted) {
    // Free table
    if (order.tableId) {
      await Table.findByIdAndUpdate(order.tableId, {
        status: 'free',
        activeOrderId: null
      });
    }
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.DELETED, { orderId: id });
  } else {
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
      order,
      action: 'item_deleted',
      itemId
    });
  }

  // Cook uchun kitchen_orders_updated yuborish
  try {
    // Aktiv smenani olish
    const activeShift = await Shift.getActiveShift(restaurantId);

    // Kitchen orders filter
    const kitchenFilter = {
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    };
    // MUHIM: Aktiv smena yo'q bo'lsa, bo'sh data yuborish va query qilmaslik
    if (!activeShift) {
      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), [], 'kitchen_orders_updated');
    } else {
      kitchenFilter.shiftId = activeShift._id;

      const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
        .populate('tableId', 'title tableNumber number')
        .populate('waiterId', 'firstName lastName')
        .sort({ createdAt: -1 });

      const kitchenOrders = rawKitchenOrders.map(o => {
        const items = o.items
          .map((i, originalIdx) => ({ i, originalIdx }))
          .filter(({ i }) => ['pending', 'preparing', 'ready'].includes(i.status) && !i.isDeleted)
          .map(({ i, originalIdx }) => ({
            ...i.toObject(),
            kitchenStatus: i.status,
            name: i.foodId?.name || i.foodName,
            requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
            categoryId: i.foodId?.categoryId?.toString() || null,
            originalIndex: originalIdx
          }));
        return {
          _id: o._id,
          orderId: o._id,
          orderNumber: o.orderNumber,
          orderType: o.orderType || 'dine-in',
          saboyNumber: o.saboyNumber,
          tableId: o.tableId,
          tableName: o.orderType === 'saboy'
            ? `Saboy #${o.saboyNumber || o.orderNumber}`
            : (o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`),
          tableNumber: o.tableId?.number || o.tableNumber,
          waiterId: o.waiterId,
          waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
          items,
          status: o.status,
          createdAt: o.createdAt,
          restaurantId: o.restaurantId
        };
      }).filter(o => o.items.length > 0);

      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
    }
  } catch (err) {
    console.error('Error sending kitchen orders after item delete:', err);
  }

  res.json({
    success: true,
    data: order,
    orderDeleted,
    remainingItems: order.activeItems.length,
    newTotal: order.grandTotal
  });
});

/**
 * Update item quantity
 * PATCH /api/orders/:id/items/:itemId/quantity
 */
const updateItemQuantity = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { quantity } = req.body;
  const { restaurantId } = req.user;

  if (!quantity || quantity < 1) {
    throw new AppError('Quantity 1 dan kam bo\'lishi mumkin emas', 400, 'VALIDATION_ERROR');
  }

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  const item = order.items.id(itemId);
  if (!item || item.isDeleted) {
    throw new AppError('Item topilmadi', 404, 'NOT_FOUND');
  }

  const oldQuantity = item.quantity;
  order.updateItemQuantity(itemId, quantity);
  await order.save();

  // Populate order data for proper response
  await order.populate('tableId', 'number floor title tableNumber');
  await order.populate('waiterId', 'firstName lastName phone');
  await order.populate('items.foodId', 'name price image categoryId requireDoubleConfirmation');

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'item_quantity_changed',
    itemId,
    oldQuantity,
    newQuantity: quantity
  });

  // Cook uchun kitchen_orders_updated yuborish
  try {
    // Aktiv smenani olish
    const activeShift = await Shift.getActiveShift(restaurantId);

    // Kitchen orders filter
    const kitchenFilter = {
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    };
    // MUHIM: Aktiv smena yo'q bo'lsa, bo'sh data yuborish va query qilmaslik
    if (!activeShift) {
      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), [], 'kitchen_orders_updated');
    } else {
      kitchenFilter.shiftId = activeShift._id;

      const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
        .populate('tableId', 'title tableNumber number')
        .populate('waiterId', 'firstName lastName')
        .sort({ createdAt: -1 });

      const kitchenOrders = rawKitchenOrders.map(o => {
        const items = o.items
          .map((i, originalIdx) => ({ i, originalIdx }))
          .filter(({ i }) => ['pending', 'preparing', 'ready'].includes(i.status) && !i.isDeleted)
          .map(({ i, originalIdx }) => ({
            ...i.toObject(),
            kitchenStatus: i.status,
            name: i.foodId?.name || i.foodName,
            requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
            categoryId: i.foodId?.categoryId?.toString() || null,
            originalIndex: originalIdx
          }));
        return {
          _id: o._id,
          orderId: o._id,
          orderNumber: o.orderNumber,
          orderType: o.orderType || 'dine-in',
          saboyNumber: o.saboyNumber,
          tableId: o.tableId,
          tableName: o.orderType === 'saboy'
            ? `Saboy #${o.saboyNumber || o.orderNumber}`
            : (o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`),
          tableNumber: o.tableId?.number || o.tableNumber,
          waiterId: o.waiterId,
          waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
          items,
          status: o.status,
          createdAt: o.createdAt,
          restaurantId: o.restaurantId
        };
      }).filter(o => o.items.length > 0);

      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
    }
  } catch (err) {
    console.error('Error sending kitchen orders:', err);
  }

  res.json({
    success: true,
    data: order,
    oldQuantity,
    newQuantity: quantity,
    newTotal: order.grandTotal
  });
});

/**
 * Mark item as ready
 * PATCH /api/orders/:id/items/:itemId/ready
 */
const markItemReady = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { restaurantId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  const item = order.items.id(itemId);
  if (!item || item.isDeleted) {
    throw new AppError('Item topilmadi', 404, 'NOT_FOUND');
  }

  item.markReady();
  await order.save();

  // Check if all items ready and notify waiter
  if (order.allItemsReady && !order.notifiedWaiter) {
    order.notifiedWaiter = true;
    order.notifiedAt = new Date();
    await order.save();

    // Create notification
    if (order.waiterId) {
      await Notification.createOrderReadyNotification(order);
    }

    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.ALL_ITEMS_READY, { order });
  } else {
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.ITEM_READY, {
      order,
      itemId,
      item
    });
  }

  res.json({
    success: true,
    data: {
      order,
      allItemsReady: order.allItemsReady
    }
  });
});

/**
 * Mark item as partially ready
 * PATCH /api/orders/:id/items/:itemId/partial-ready
 */
const markItemPartialReady = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { readyCount } = req.body;
  const { restaurantId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  const item = order.items.id(itemId);
  if (!item || item.isDeleted) {
    throw new AppError('Item topilmadi', 404, 'NOT_FOUND');
  }

  item.readyQuantity = Math.min(readyCount, item.quantity);
  if (item.readyQuantity >= item.quantity) {
    item.status = 'ready';
    item.readyAt = new Date();
  } else {
    item.status = 'preparing';
  }

  await order.save();

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'item_partial_ready',
    itemId,
    readyQuantity: item.readyQuantity
  });

  res.json({
    success: true,
    data: { order }
  });
});

/**
 * Process payment
 * POST /api/orders/:id/pay
 */
const processPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId, id: userId } = req.user;
  const { paymentType, paymentSplit, comment } = req.body;

  if (!paymentType) {
    throw new AppError('To\'lov turi kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  if (order.isPaid) {
    throw new AppError('Order allaqachon to\'langan', 400, 'ALREADY_PAID');
  }

  await order.processPayment(paymentType, userId, paymentSplit, comment);

  // Free the table
  if (order.tableId) {
    await Table.findByIdAndUpdate(order.tableId, {
      status: 'free',
      activeOrderId: null
    });
  }

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.PAID, {
    order,
    paymentType
  });

  res.json({
    success: true,
    data: { order }
  });
});

/**
 * Change waiter
 * PATCH /api/orders/:id/waiter
 */
const changeWaiter = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { waiterId } = req.body;
  const { restaurantId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  const Staff = require('../models').Staff;
  const newWaiter = await Staff.findOne({
    _id: waiterId,
    restaurantId,
    role: 'waiter'
  });

  if (!newWaiter) {
    throw new AppError('Ofitsiant topilmadi', 404, 'NOT_FOUND');
  }

  const oldWaiterId = order.waiterId;
  const oldWaiterName = order.waiterName;

  order.waiterId = waiterId;
  order.waiterName = newWaiter.fullName;
  await order.save();

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'waiter_changed',
    oldWaiterId,
    newWaiterId: waiterId
  });

  res.json({
    success: true,
    data: {
      order,
      oldWaiterId,
      oldWaiterName,
      newWaiterId: waiterId,
      newWaiterName: newWaiter.fullName
    }
  });
});

/**
 * Approve order (waiter approves customer order)
 * POST /api/orders/:id/approve
 */
const approveOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId, id: userId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId })
    .populate('tableId', 'title tableNumber number')
    .populate('waiterId', 'firstName lastName');

  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  if (order.waiterApproved) {
    throw new AppError('Order allaqachon tasdiqlangan', 400, 'ALREADY_APPROVED');
  }

  order.approve(userId);
  await order.save();

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.APPROVED, { order });

  // Cook uchun kitchen_orders_updated yuborish (including ready items)
  try {
    // Aktiv smenani olish
    const activeShift = await Shift.getActiveShift(restaurantId);

    // Kitchen orders filter
    const kitchenFilter = {
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    };
    // MUHIM: Aktiv smena yo'q bo'lsa, bo'sh data yuborish va query qilmaslik
    if (!activeShift) {
      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), [], 'kitchen_orders_updated');
    } else {
      kitchenFilter.shiftId = activeShift._id;

      const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
        .populate('tableId', 'title tableNumber number')
        .populate('waiterId', 'firstName lastName')
        .sort({ createdAt: -1 });

      // Transform for cook-web format
      const kitchenOrders = rawKitchenOrders.map(o => {
        const items = o.items
          .map((i, originalIdx) => ({ i, originalIdx }))
          .filter(({ i }) => ['pending', 'preparing', 'ready'].includes(i.status))
          .map(({ i, originalIdx }) => ({
            ...i.toObject(),
            kitchenStatus: i.status,
            name: i.foodId?.name || i.foodName,
            requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
            categoryId: i.foodId?.categoryId?.toString() || null,
            originalIndex: originalIdx
          }));
        return {
          _id: o._id,
          orderId: o._id,
          orderNumber: o.orderNumber,
          orderType: o.orderType || 'dine-in',
          saboyNumber: o.saboyNumber,
          tableId: o.tableId,
          tableName: o.orderType === 'saboy'
            ? `Saboy #${o.saboyNumber || o.orderNumber}`
            : (o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`),
          tableNumber: o.tableId?.number || o.tableNumber,
          waiterId: o.waiterId,
          waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
          items,
          status: o.status,
          createdAt: o.createdAt,
          restaurantId: o.restaurantId
        };
      }).filter(o => o.items.length > 0);

      // Admin uchun barcha itemlar
      socketService.emitToRole(restaurantId.toString(), 'admin', 'new_kitchen_order', {
        order: order,
        allOrders: kitchenOrders,
        isNewOrder: true,
        newItems: order.items.map((i, idx) => ({ ...i.toObject(), kitchenStatus: i.status, originalIndex: idx }))
      });
      // Har bir cook uchun filter qilingan
      await socketService.emitFilteredNewKitchenOrder(restaurantId.toString(), order, kitchenOrders);
      await socketService.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
    }
  } catch (err) {
    console.error('Error sending kitchen orders:', err);
  }

  // Flutter waiter app uchun approve_order_response yuborish
  if (order.waiterId) {
    socketService.emitToUser(order.waiterId._id?.toString() || order.waiterId.toString(), 'approve_order_response', {
      success: true,
      order,
      orderId: order._id
    });
  }

  res.json({
    success: true,
    data: { order }
  });
});

/**
 * Reject order
 * POST /api/orders/:id/reject
 */
const rejectOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const { restaurantId, id: userId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId })
    .populate('tableId', 'title tableNumber number')
    .populate('waiterId', 'firstName lastName');

  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  order.reject(userId, reason);
  await order.save();

  // Free table
  if (order.tableId) {
    await Table.findByIdAndUpdate(order.tableId, {
      status: 'free',
      activeOrderId: null
    });
  }

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.REJECTED, {
    orderId: id,
    reason
  });

  // Flutter waiter app uchun reject_order_response yuborish
  if (order.waiterId) {
    socketService.emitToUser(order.waiterId._id?.toString() || order.waiterId.toString(), 'reject_order_response', {
      success: true,
      orderId: order._id,
      reason
    });
  }

  res.json({
    success: true,
    data: { order }
  });
});

/**
 * Get waiter stats
 * GET /api/orders/waiter-stats
 */
const getWaiterStats = asyncHandler(async (req, res) => {
  const { restaurantId } = req.user;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const stats = await Order.aggregate([
    {
      $match: {
        restaurantId: require('mongoose').Types.ObjectId.createFromHexString(restaurantId.toString()),
        createdAt: { $gte: startOfDay },
        isPaid: true,
        isDeleted: { $ne: true }
      }
    },
    {
      $group: {
        _id: '$waiterId',
        orders: { $sum: 1 },
        revenue: { $sum: '$grandTotal' }
      }
    },
    {
      $lookup: {
        from: 'staffs',
        localField: '_id',
        foreignField: '_id',
        as: 'waiter'
      }
    },
    { $unwind: '$waiter' },
    {
      $project: {
        _id: 1,
        name: { $concat: ['$waiter.firstName', ' ', '$waiter.lastName'] },
        orders: 1,
        revenue: 1
      }
    },
    { $sort: { revenue: -1 } }
  ]);

  res.json({
    success: true,
    data: { stats }
  });
});

/**
 * TZ 1.1: Cancel item (admin only)
 * POST /api/orders/:id/items/:itemId/cancel
 */
const cancelItem = asyncHandler(async (req, res) => {
  const { id, itemId } = req.params;
  const { reason } = req.body;
  const { restaurantId, id: userId, fullName } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  const item = order.items.id(itemId);
  if (!item || item.isDeleted) {
    throw new AppError('Item topilmadi', 404, 'NOT_FOUND');
  }

  if (item.status === 'cancelled') {
    throw new AppError('Item allaqachon bekor qilingan', 400, 'ALREADY_CANCELLED');
  }

  // Bekor qilish ma'lumotlarini saqlash
  order.cancelItem(itemId, userId, fullName, reason);
  await order.save();

  // Barcha itemlar cancelled bo'lsa, orderni ham cancel qilish
  const activeItems = order.items.filter(i => !i.isDeleted && i.status !== 'cancelled');
  let orderCancelled = false;

  if (activeItems.length === 0) {
    // Barcha itemlar bekor qilindi - orderni ham bekor qilish
    order.status = 'cancelled';
    order.cancelledAt = new Date();
    order.cancelledBy = userId;
    order.cancelReason = 'Barcha taomlar bekor qilindi';
    await order.save();
    orderCancelled = true;

    // Stolni bo'shatish
    if (order.tableId) {
      const Table = require('../models/table');
      await Table.findByIdAndUpdate(order.tableId, {
        status: 'free',
        activeOrderId: null
      });
    }
  }

  // Populate for response
  await order.populate('tableId', 'title tableNumber hasHourlyCharge hourlyChargeAmount');
  await order.populate('waiterId', 'firstName lastName');

  // Event yuborish
  if (orderCancelled) {
    // Order butunlay bekor qilindi
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.CANCELLED, {
      order,
      reason: 'Barcha taomlar bekor qilindi'
    });
  } else {
    // Faqat item bekor qilindi
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
      order,
      action: 'item_cancelled',
      itemId,
      cancelledItem: {
        foodName: item.foodName,
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
        reason: reason
      }
    });
  }

  res.json({
    success: true,
    message: orderCancelled ? 'Barcha taomlar bekor qilindi, buyurtma bekor qilindi' : 'Item bekor qilindi',
    data: {
      order,
      orderCancelled,
      cancelledItem: {
        _id: itemId,
        foodName: item.foodName,
        quantity: item.quantity,
        price: item.price,
        total: item.price * item.quantity,
        cancelledBy: fullName,
        cancelledAt: item.cancelledAt,
        reason: reason
      }
    }
  });
});

/**
 * TZ 3.5: Transfer order to another table
 * POST /api/orders/:id/transfer
 */
const transferOrder = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { newTableId } = req.body;
  const { restaurantId, id: userId, fullName } = req.user;

  if (!newTableId) {
    throw new AppError('Yangi stol ID kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  if (order.isPaid) {
    throw new AppError('To\'langan buyurtmani ko\'chirish mumkin emas', 400, 'ALREADY_PAID');
  }

  // Yangi stolni tekshirish
  const newTable = await Table.findOne({ _id: newTableId, restaurantId });
  if (!newTable) {
    throw new AppError('Yangi stol topilmadi', 404, 'NOT_FOUND');
  }

  // Eski stolni bo'shatish
  const oldTableId = order.tableId;
  if (oldTableId) {
    await Table.findByIdAndUpdate(oldTableId, {
      status: 'free',
      activeOrderId: null
    });
  }

  // Stol ko'chirish
  const newWaiterId = newTable.assignedWaiterId || order.waiterId;
  let newWaiterName = order.waiterName;

  if (newTable.assignedWaiterId && newTable.assignedWaiterId.toString() !== order.waiterId?.toString()) {
    const Staff = require('../models').Staff;
    const newWaiter = await Staff.findById(newTable.assignedWaiterId);
    if (newWaiter) {
      newWaiterName = newWaiter.fullName;
    }
  }

  order.transferToTable(newTableId, newWaiterId, newWaiterName, userId);
  order.tableName = newTable.title;
  await order.save();

  // Yangi stolni band qilish
  await Table.findByIdAndUpdate(newTableId, {
    status: 'occupied',
    activeOrderId: order._id
  });

  await order.populate('tableId', 'title tableNumber');
  await order.populate('waiterId', 'firstName lastName');

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'order_transferred',
    fromTableId: oldTableId,
    toTableId: newTableId
  });

  res.json({
    success: true,
    message: 'Buyurtma yangi stolga ko\'chirildi',
    data: {
      order,
      fromTableId: oldTableId,
      toTableId: newTableId,
      serviceChargeGoesTo: order.serviceChargeWaiterId
    }
  });
});

/**
 * TZ 3.1: Create personal order (waiter for themselves)
 * POST /api/orders/personal
 */
const createPersonalOrder = asyncHandler(async (req, res) => {
  const { restaurantId, id: userId, fullName } = req.user;
  const { items, comment } = req.body;

  // Aktiv smenani tekshirish
  const activeShift = await checkActiveShift(restaurantId);

  if (!items || items.length === 0) {
    throw new AppError('Kamida bitta taom kerak', 400, 'VALIDATION_ERROR');
  }

  // === Stop-list va limit tekshiruvi (agregatsiya bilan) ===
  const foodQuantityMap = new Map();
  for (const item of items) {
    if (item.foodId) {
      const foodIdStr = item.foodId.toString();
      const qty = item.quantity || 1;
      if (foodQuantityMap.has(foodIdStr)) {
        foodQuantityMap.get(foodIdStr).quantity += qty;
      } else {
        foodQuantityMap.set(foodIdStr, { quantity: qty });
      }
    }
  }

  const unavailableFoods = [];
  for (const [foodIdStr, { quantity: totalQty }] of foodQuantityMap) {
    const food = await Food.findById(foodIdStr);
    if (food) {
      await food.checkAndResetDailyCount(true);
      if (food.isInStopList) {
        unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: food.stopListReason || 'Stop-listda' });
        continue;
      }
      if (food.autoStopListEnabled && food.dailyOrderLimit > 0) {
        const remaining = food.dailyOrderLimit - food.dailyOrderCount;
        if (remaining <= 0) {
          unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: 'Kunlik limit tugagan' });
        } else if (totalQty > remaining) {
          unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: `Faqat ${remaining} ta qolgan (${totalQty} ta so'ralgan)` });
        }
      }
      if (food.isAvailable === false) {
        unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: 'Taom mavjud emas' });
      }
    }
  }
  if (unavailableFoods.length > 0) {
    throw new AppError(`Quyidagi taomlar buyurtma qilib bo'lmaydi: ${unavailableFoods.map(f => f.foodName).join(', ')}`, 400, 'FOOD_UNAVAILABLE', { unavailableFoods });
  }

  // Prepare items
  const orderItems = await Promise.all(items.map(async (item) => {
    const food = await Food.findById(item.foodId);
    return {
      foodId: item.foodId,
      foodName: food ? food.foodName || food.name : item.foodName,
      categoryId: food ? food.categoryId : item.categoryId,
      quantity: item.quantity || 1,
      price: food ? food.price : item.price,
      addedBy: userId,
      addedByName: fullName
    };
  }));

  const orderNumber = await Order.getNextOrderNumber(restaurantId);

  const order = new Order({
    restaurantId,
    shiftId: activeShift._id,
    orderNumber,
    orderType: 'dine-in',
    items: orderItems,
    waiterId: userId,
    waiterName: fullName,
    waiterApproved: true,
    approvedAt: new Date(),
    source: 'waiter',
    comment,
    isPersonalOrder: true,
    personalOrderStaffId: userId,
    deductFromSalary: true,
    // Shaxsiy buyurtmalarda xizmat haqi yo'q
    serviceChargePercent: 0
  });

  await order.save();

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.CREATED, { order, isPersonalOrder: true });

  res.status(201).json({
    success: true,
    message: 'Shaxsiy buyurtma yaratildi. Maoshdan ushlab qolinadi.',
    data: order
  });
});

/**
 * Create Saboy order (take-away with number)
 * POST /api/orders/saboy
 */
const createSaboyOrder = asyncHandler(async (req, res) => {
  const { restaurantId, id: userId, fullName } = req.user;
  const { items, saboyNumber, comment } = req.body;

  // Aktiv smenani tekshirish
  const activeShift = await checkActiveShift(restaurantId);

  if (!items || items.length === 0) {
    throw new AppError('Kamida bitta taom kerak', 400, 'VALIDATION_ERROR');
  }

  // === Stop-list va limit tekshiruvi (agregatsiya bilan) ===
  const foodQuantityMap = new Map();
  for (const item of items) {
    if (item.foodId) {
      const foodIdStr = item.foodId.toString();
      const qty = item.quantity || 1;
      if (foodQuantityMap.has(foodIdStr)) {
        foodQuantityMap.get(foodIdStr).quantity += qty;
      } else {
        foodQuantityMap.set(foodIdStr, { quantity: qty });
      }
    }
  }

  const unavailableFoods = [];
  for (const [foodIdStr, { quantity: totalQty }] of foodQuantityMap) {
    const food = await Food.findById(foodIdStr);
    if (food) {
      await food.checkAndResetDailyCount(true);
      if (food.isInStopList) {
        unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: food.stopListReason || 'Stop-listda' });
        continue;
      }
      if (food.autoStopListEnabled && food.dailyOrderLimit > 0) {
        const remaining = food.dailyOrderLimit - food.dailyOrderCount;
        if (remaining <= 0) {
          unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: 'Kunlik limit tugagan' });
        } else if (totalQty > remaining) {
          unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: `Faqat ${remaining} ta qolgan (${totalQty} ta so'ralgan)` });
        }
      }
      if (food.isAvailable === false) {
        unavailableFoods.push({ foodId: food._id, foodName: food.foodName, reason: 'Taom mavjud emas' });
      }
    }
  }
  if (unavailableFoods.length > 0) {
    throw new AppError(`Quyidagi taomlar buyurtma qilib bo'lmaydi: ${unavailableFoods.map(f => f.foodName).join(', ')}`, 400, 'FOOD_UNAVAILABLE', { unavailableFoods });
  }

  // Validate saboyNumber
  let finalSaboyNumber;
  if (saboyNumber !== undefined && saboyNumber !== null && saboyNumber !== '') {
    const parsedNumber = parseInt(saboyNumber);
    if (isNaN(parsedNumber) || parsedNumber < 1) {
      throw new AppError('Saboy raqami 1 dan katta butun son bo\'lishi kerak', 400, 'VALIDATION_ERROR');
    }
    finalSaboyNumber = parsedNumber;
  } else {
    // Default to next order number
    const orderNumber = await Order.getNextOrderNumber(restaurantId);
    finalSaboyNumber = orderNumber;
  }

  // Check if saboyNumber already exists today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const existingSaboy = await Order.findOne({
    restaurantId,
    orderType: 'saboy',
    saboyNumber: finalSaboyNumber,
    createdAt: { $gte: startOfDay },
    isDeleted: { $ne: true }
  });

  if (existingSaboy) {
    throw new AppError(`Saboy #${finalSaboyNumber} bugun allaqachon mavjud`, 400, 'DUPLICATE_SABOY');
  }

  // Prepare items
  const orderItems = await Promise.all(items.map(async (item) => {
    const food = await Food.findById(item.foodId);
    return {
      foodId: item.foodId,
      foodName: food ? food.foodName || food.name : item.foodName,
      categoryId: food ? food.categoryId : item.categoryId,
      quantity: item.quantity || 1,
      price: food ? food.price : item.price,
      addedBy: userId,
      addedByName: fullName
    };
  }));

  const orderNumber = await Order.getNextOrderNumber(restaurantId);

  const order = new Order({
    restaurantId,
    shiftId: activeShift._id,
    orderNumber,
    orderType: 'saboy',
    saboyNumber: finalSaboyNumber,
    tableName: `Saboy #${finalSaboyNumber}`,
    items: orderItems,
    waiterId: userId,
    waiterName: fullName,
    waiterApproved: true,
    approvedAt: new Date(),
    source: 'cashier',
    comment,
    // Saboy - xizmat haqi yo'q (olib ketish)
    serviceChargePercent: 0
  });

  await order.save();

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.CREATED, { order, isSaboy: true });

  // Cook uchun kitchen_orders_updated yuborish
  try {
    const rawKitchenOrders = await Order.find({
      restaurantId,
      shiftId: activeShift._id, // Faqat joriy smena buyurtmalari
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    }).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .map((i, originalIdx) => ({ i, originalIdx }))
        .filter(({ i }) => ['pending', 'preparing', 'ready'].includes(i.status))
        .map(({ i, originalIdx }) => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName,
          requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
          categoryId: i.foodId?.categoryId?.toString() || null,
          originalIndex: originalIdx
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
        orderType: o.orderType,
        saboyNumber: o.saboyNumber,
        tableId: o.tableId,
        tableName: o.orderType === 'saboy' ? `Saboy #${o.saboyNumber}` : (o.tableId?.title || o.tableName),
        tableNumber: o.tableId?.number || o.tableNumber,
        waiterId: o.waiterId,
        waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
        items,
        status: o.status,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId
      };
    }).filter(o => o.items.length > 0);

    // Admin uchun barcha itemlar
    socketService.emitToRole(restaurantId.toString(), 'admin', 'new_kitchen_order', {
      order: order,
      allOrders: kitchenOrders,
      isNewOrder: true,
      isSaboy: true,
      newItems: orderItems.map((i, idx) => ({ ...i, kitchenStatus: 'pending', originalIndex: idx }))
    });
    // Har bir cook uchun filter qilingan
    await socketService.emitFilteredNewKitchenOrder(restaurantId.toString(), order, kitchenOrders);
    await socketService.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
  } catch (err) {
    console.error('Error sending kitchen orders:', err);
  }

  res.status(201).json({
    success: true,
    message: `Saboy buyurtma yaratildi: #${order.saboyNumber}`,
    data: order
  });
});

/**
 * TZ 3.3: Get archived orders for a specific date
 * GET /api/orders/archive/:date
 */
const getArchivedOrders = asyncHandler(async (req, res) => {
  const { date } = req.params;
  const { restaurantId, id: userId, role } = req.user;

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const filter = {
    restaurantId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    isPaid: true
  };

  // Waiter faqat o'z buyurtmalarini ko'radi
  if (role === 'waiter') {
    filter.$or = [
      { waiterId: userId },
      { originalWaiterId: userId },
      { serviceChargeWaiterId: userId }
    ];
  }

  const orders = await Order.find(filter)
    .populate('waiterId', 'firstName lastName')
    .populate('tableId', 'title tableNumber')
    .sort({ paidAt: -1 });

  // Kunlik statistika
  const summary = {
    totalOrders: orders.length,
    totalRevenue: orders.reduce((sum, o) => sum + o.grandTotal, 0),
    totalServiceCharge: orders.reduce((sum, o) => sum + o.serviceCharge, 0)
  };

  res.json({
    success: true,
    data: {
      date: date,
      orders,
      summary
    }
  });
});

/**
 * TZ 3.4: Get waiter daily income (5% from service)
 * GET /api/orders/waiter-income/:waiterId
 */
const getWaiterDailyIncome = asyncHandler(async (req, res) => {
  const { waiterId } = req.params;
  const { date } = req.query;
  const { restaurantId } = req.user;

  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // Xizmat haqi shu ofitsiantga tegishli bo'lgan buyurtmalar
  const orders = await Order.find({
    restaurantId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    isPaid: true,
    $or: [
      { serviceChargeWaiterId: waiterId },
      { waiterId: waiterId, serviceChargeWaiterId: { $exists: false } }
    ]
  });

  const totalServiceCharge = orders.reduce((sum, o) => sum + o.serviceCharge, 0);
  // Ofitsiant xizmat haqidan 5% oladi
  const waiterIncome = Math.round(totalServiceCharge * 0.05);

  res.json({
    success: true,
    data: {
      waiterId,
      date: targetDate.toISOString().split('T')[0],
      ordersCount: orders.length,
      totalServiceCharge,
      waiterIncomePercent: 5,
      waiterIncome
    }
  });
});

/**
 * TZ 3.4: Get my daily income (for waiter)
 * GET /api/orders/my-income
 */
const getMyDailyIncome = asyncHandler(async (req, res) => {
  const { restaurantId, id: userId } = req.user;
  const { date } = req.query;

  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const orders = await Order.find({
    restaurantId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    isPaid: true,
    $or: [
      { serviceChargeWaiterId: userId },
      { waiterId: userId, serviceChargeWaiterId: { $exists: false } }
    ]
  }).populate('tableId', 'title');

  const totalServiceCharge = orders.reduce((sum, o) => sum + o.serviceCharge, 0);
  const waiterIncome = Math.round(totalServiceCharge * 0.05);

  res.json({
    success: true,
    data: {
      date: targetDate.toISOString().split('T')[0],
      ordersCount: orders.length,
      orders: orders.map(o => ({
        _id: o._id,
        orderNumber: o.orderNumber,
        tableName: o.tableId?.title || o.tableName,
        grandTotal: o.grandTotal,
        serviceCharge: o.serviceCharge,
        paidAt: o.paidAt
      })),
      totalServiceCharge,
      waiterIncomePercent: 5,
      waiterIncome,
      message: `Bugungi daromadingiz: ${waiterIncome.toLocaleString()} so'm`
    }
  });
});

/**
 * Merge multiple orders into one
 * POST /api/orders/merge
 */
const mergeOrders = asyncHandler(async (req, res) => {
  const { restaurantId, id: userId, fullName } = req.user;
  const { targetOrderId, sourceOrderIds } = req.body;

  if (!targetOrderId) {
    throw new AppError('Asosiy buyurtma ID kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  if (!sourceOrderIds || !Array.isArray(sourceOrderIds) || sourceOrderIds.length === 0) {
    throw new AppError('Biriktiriladigan buyurtmalar ID lari kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  // Target orderni topish
  const targetOrder = await Order.findOne({
    _id: targetOrderId,
    restaurantId,
    isPaid: false,
    isDeleted: { $ne: true },
    status: { $nin: ['paid', 'cancelled'] }
  });

  if (!targetOrder) {
    throw new AppError('Asosiy buyurtma topilmadi yoki to\'langan', 404, 'NOT_FOUND');
  }

  // Source orderlarni topish
  const sourceOrders = await Order.find({
    _id: { $in: sourceOrderIds },
    restaurantId,
    isPaid: false,
    isDeleted: { $ne: true },
    status: { $nin: ['paid', 'cancelled'] }
  });

  if (sourceOrders.length === 0) {
    throw new AppError('Biriktiriladigan buyurtmalar topilmadi', 404, 'NOT_FOUND');
  }

  // Har bir source orderdan itemlarni target orderga qo'shish
  const mergedItems = [];
  const mergedOrderIds = [];
  const freedTableIds = [];

  for (const sourceOrder of sourceOrders) {
    // Source orderdagi barcha aktiv itemlarni olish
    const activeItems = sourceOrder.items.filter(item => !item.isDeleted && item.status !== 'cancelled');

    for (const item of activeItems) {
      // Itemni target orderga qo'shish
      targetOrder.items.push({
        foodId: item.foodId,
        foodName: item.foodName,
        categoryId: item.categoryId,
        quantity: item.quantity,
        price: item.price,
        status: item.status,
        readyQuantity: item.readyQuantity || 0,
        addedAt: item.addedAt || new Date(),
        addedBy: item.addedBy,
        addedByName: item.addedByName,
        // Qo'shimcha ma'lumot - qaysi orderdan kelgani
        mergedFrom: sourceOrder._id
      });

      mergedItems.push({
        foodName: item.foodName,
        quantity: item.quantity,
        fromOrder: sourceOrder.orderNumber
      });
    }

    // Comment birlashtirish
    if (sourceOrder.comment) {
      targetOrder.comment = targetOrder.comment
        ? `${targetOrder.comment}\n[Buyurtma #${sourceOrder.orderNumber}]: ${sourceOrder.comment}`
        : `[Buyurtma #${sourceOrder.orderNumber}]: ${sourceOrder.comment}`;
    }

    // Source orderni o'chirish (soft delete)
    sourceOrder.isDeleted = true;
    sourceOrder.deletedAt = new Date();
    sourceOrder.deletedBy = userId;
    sourceOrder.deletedReason = `Buyurtma #${targetOrder.orderNumber} ga biriktirildi`;
    await sourceOrder.save();

    mergedOrderIds.push(sourceOrder._id);

    // Source order stolini bo'shatish
    if (sourceOrder.tableId) {
      freedTableIds.push(sourceOrder.tableId);
      await Table.findByIdAndUpdate(sourceOrder.tableId, {
        status: 'free',
        activeOrderId: null
      });
    }
  }

  // Target orderni saqlash
  await targetOrder.save();

  // Populate qilish
  await targetOrder.populate('tableId', 'title tableNumber number');
  await targetOrder.populate('waiterId', 'firstName lastName');

  // Socket event yuborish
  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order: targetOrder,
    action: 'orders_merged',
    mergedOrderIds,
    mergedItems
  });

  // O'chirilgan orderlar uchun event
  for (const orderId of mergedOrderIds) {
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.DELETED, { orderId });
  }

  res.json({
    success: true,
    message: `${sourceOrders.length} ta buyurtma biriktirildi`,
    data: {
      order: targetOrder,
      mergedOrderIds,
      mergedItemsCount: mergedItems.length,
      freedTableIds
    }
  });
});

/**
 * Process partial payment (pay selected items)
 * POST /api/orders/:id/pay-items
 */
const processPartialPayment = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId, id: userId, fullName } = req.user;
  const { itemIds, paymentType, paymentSplit, comment } = req.body;

  // Validatsiya
  if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
    throw new AppError('Item IDlar kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  if (!paymentType) {
    throw new AppError('To\'lov turi kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  const order = await Order.findOne({ _id: id, restaurantId })
    .populate('tableId', 'title tableNumber');

  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  if (order.isPaid) {
    throw new AppError('Order allaqachon to\'langan', 400, 'ALREADY_PAID');
  }

  // Partial payment ni amalga oshirish
  const result = order.processPartialPayment(
    itemIds,
    paymentType,
    userId,
    fullName,
    paymentSplit,
    comment
  );

  await order.save();

  // Populate for response
  await order.populate('tableId', 'title tableNumber');
  await order.populate('waiterId', 'firstName lastName');

  // Agar barcha itemlar to'langan bo'lsa - stolni bo'shatish
  if (result.allItemsPaid && order.tableId) {
    await Table.findByIdAndUpdate(order.tableId, {
      status: 'free',
      activeOrderId: null
    });
  }

  // Socket events
  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'partial_payment',
    paidItemIds: itemIds,
    allItemsPaid: result.allItemsPaid,
    remainingTotal: result.remainingTotal
  });

  // Agar to'liq to'langan bo'lsa, PAID eventni ham yuborish
  if (result.allItemsPaid) {
    emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.PAID, {
      order,
      paymentType: 'mixed'
    });
  }

  res.json({
    success: true,
    message: result.allItemsPaid
      ? 'Barcha taomlar to\'landi, stol bo\'shatildi'
      : `${itemIds.length} ta taom to\'landi`,
    data: {
      order,
      paymentSession: {
        sessionId: result.sessionId,
        paidItems: result.paidItems,
        subtotal: result.subtotal,
        serviceCharge: result.serviceCharge,
        total: result.total,
        paymentType: result.paymentType,
        paidAt: result.paidAt
      },
      allItemsPaid: result.allItemsPaid,
      remainingTotal: result.remainingTotal,
      paidTotal: order.getPaidTotal(),
      unpaidTotal: order.getUnpaidTotal()
    }
  });
});

/**
 * Get unpaid items for an order
 * GET /api/orders/:id/unpaid-items
 */
const getUnpaidItems = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { restaurantId } = req.user;

  const order = await Order.findOne({ _id: id, restaurantId });

  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  const unpaidItems = order.getUnpaidItems();
  const paidItems = order.getPaidItems();

  res.json({
    success: true,
    data: {
      unpaidItems,
      paidItems,
      unpaidTotal: order.getUnpaidTotal(),
      paidTotal: order.getPaidTotal(),
      allItemsPaid: order.areAllItemsPaid()
    }
  });
});

module.exports = {
  getOrders,
  getTodayOrders,
  getDailySummary,
  getOrder,
  createOrder,
  updateOrder,
  deleteOrder,
  addItems,
  deleteItem,
  updateItemQuantity,
  markItemReady,
  markItemPartialReady,
  processPayment,
  changeWaiter,
  approveOrder,
  rejectOrder,
  getWaiterStats,
  // Yangi funksiyalar
  cancelItem,
  transferOrder,
  createPersonalOrder,
  createSaboyOrder,
  getArchivedOrders,
  getWaiterDailyIncome,
  getMyDailyIncome,
  mergeOrders,
  // Partial payment
  processPartialPayment,
  getUnpaidItems
};
