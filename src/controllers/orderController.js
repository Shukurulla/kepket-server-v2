const { Order, Table, Food, Notification } = require('../models');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const { emitOrderEvent, ORDER_EVENTS, emitToUser, emitToRole } = require('../events/eventEmitter');
const socketService = require('../services/socketService');

/**
 * Get orders with filters
 * GET /api/orders
 */
const getOrders = asyncHandler(async (req, res) => {
  const { restaurantId } = req.user;
  const {
    status,
    waiterId,
    tableId,
    isPaid,
    date,
    page = 1,
    limit = 50
  } = req.query;

  const filter = { restaurantId };

  // Apply filters
  if (status) filter.status = status;
  if (waiterId) filter.waiterId = waiterId;
  if (tableId) filter.tableId = tableId;
  if (isPaid !== undefined) filter.isPaid = isPaid === 'true';

  // Date filter
  if (date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    filter.createdAt = { $gte: startOfDay, $lte: endOfDay };
  }

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

/**
 * Get today's orders
 * GET /api/orders/today
 */
const getTodayOrders = asyncHandler(async (req, res) => {
  const { restaurantId } = req.user;
  const { isPaid } = req.query;

  const filter = {};
  if (isPaid !== undefined) filter.isPaid = isPaid === 'true';

  const orders = await Order.getTodayOrders(restaurantId, filter)
    .populate('waiterId', 'firstName lastName')
    .populate('tableId', 'title tableNumber');

  res.json({
    success: true,
    data: { orders }
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

  // Validate items
  if (!items || items.length === 0) {
    throw new AppError('Kamida bitta taom kerak', 400, 'VALIDATION_ERROR');
  }

  // Prepare items with food details
  const orderItems = await Promise.all(items.map(async (item) => {
    const food = await Food.findById(item.foodId);
    return {
      foodId: item.foodId,
      foodName: food ? food.foodName || food.name : item.foodName,
      categoryId: food ? food.categoryId : item.categoryId,
      quantity: item.quantity || 1,
      price: food ? food.price : item.price
    };
  }));

  let order;
  let isNewOrder = false;

  // Agar tableId bo'lsa va forceNewOrder false bo'lsa, mavjud to'lanmagan orderni qidirish
  if (tableId && !forceNewOrder && orderType === 'dine-in') {
    // Shu stol uchun to'lanmagan order bor-yo'qligini tekshirish
    const existingOrder = await Order.findOne({
      restaurantId,
      tableId,
      isPaid: false,
      status: { $nin: ['paid', 'cancelled'] }
    });

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
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    }).populate('items.foodId', 'name price categoryId image')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Transform for cook-web format
    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .filter(i => ['pending', 'preparing', 'ready'].includes(i.status))
        .map(i => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
        tableId: o.tableId,
        tableName: o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`,
        tableNumber: o.tableId?.number || o.tableNumber,
        waiterId: o.waiterId,
        waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
        items,
        status: o.status,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId
      };
    }).filter(o => o.items.length > 0);

    socketService.emitToRole(restaurantId.toString(), 'cook', 'new_kitchen_order', {
      order: order,
      allOrders: kitchenOrders,
      isNewOrder: isNewOrder,
      itemsAddedToExisting: !isNewOrder,
      newItems: orderItems.map(i => ({ ...i, kitchenStatus: 'pending' }))
    });
    socketService.emitToRole(restaurantId.toString(), 'cook', 'kitchen_orders_updated', kitchenOrders);
    socketService.emitToRole(restaurantId.toString(), 'admin', 'kitchen_orders_updated', kitchenOrders);
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
    const rawKitchenOrders = await Order.find({
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    }).populate('items.foodId', 'name price categoryId image')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .filter(i => ['pending', 'preparing', 'ready'].includes(i.status) && !i.isDeleted)
        .map(i => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
        tableId: o.tableId,
        tableName: o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`,
        tableNumber: o.tableId?.number || o.tableNumber,
        waiterId: o.waiterId,
        waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
        items,
        status: o.status,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId
      };
    }).filter(o => o.items.length > 0);

    socketService.emitToRole(restaurantId.toString(), 'cook', 'kitchen_orders_updated', kitchenOrders);
    socketService.emitToRole(restaurantId.toString(), 'admin', 'kitchen_orders_updated', kitchenOrders);
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
  const { restaurantId } = req.user;
  const { items } = req.body;

  const order = await Order.findOne({ _id: id, restaurantId });
  if (!order) {
    throw new AppError('Order topilmadi', 404, 'NOT_FOUND');
  }

  // Add items
  for (const item of items) {
    const food = await Food.findById(item.foodId);
    order.addItem({
      foodId: item.foodId,
      foodName: food ? food.foodName : item.foodName,
      categoryId: food ? food.categoryId : item.categoryId,
      quantity: item.quantity || 1,
      price: food ? food.price : item.price
    });
  }

  await order.save();

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'items_added',
    newItems: items
  });

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
  await order.populate('items.foodId', 'name price image categoryId');

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
    const rawKitchenOrders = await Order.find({
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    }).populate('items.foodId', 'name price categoryId image')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .filter(i => ['pending', 'preparing', 'ready'].includes(i.status) && !i.isDeleted)
        .map(i => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
        tableId: o.tableId,
        tableName: o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`,
        tableNumber: o.tableId?.number || o.tableNumber,
        waiterId: o.waiterId,
        waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
        items,
        status: o.status,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId
      };
    }).filter(o => o.items.length > 0);

    socketService.emitToRole(restaurantId.toString(), 'cook', 'kitchen_orders_updated', kitchenOrders);
    socketService.emitToRole(restaurantId.toString(), 'admin', 'kitchen_orders_updated', kitchenOrders);
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
  await order.populate('items.foodId', 'name price image categoryId');

  emitOrderEvent(restaurantId.toString(), ORDER_EVENTS.UPDATED, {
    order,
    action: 'item_quantity_changed',
    itemId,
    oldQuantity,
    newQuantity: quantity
  });

  // Cook uchun kitchen_orders_updated yuborish
  try {
    const rawKitchenOrders = await Order.find({
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    }).populate('items.foodId', 'name price categoryId image')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .filter(i => ['pending', 'preparing', 'ready'].includes(i.status) && !i.isDeleted)
        .map(i => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
        tableId: o.tableId,
        tableName: o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`,
        tableNumber: o.tableId?.number || o.tableNumber,
        waiterId: o.waiterId,
        waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
        items,
        status: o.status,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId
      };
    }).filter(o => o.items.length > 0);

    socketService.emitToRole(restaurantId.toString(), 'cook', 'kitchen_orders_updated', kitchenOrders);
    socketService.emitToRole(restaurantId.toString(), 'admin', 'kitchen_orders_updated', kitchenOrders);
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
    const rawKitchenOrders = await Order.find({
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready'] },
      'items.status': { $in: ['pending', 'preparing', 'ready'] }
    }).populate('items.foodId', 'name price categoryId image')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Transform for cook-web format
    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .filter(i => ['pending', 'preparing', 'ready'].includes(i.status))
        .map(i => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
        tableId: o.tableId,
        tableName: o.tableId?.title || o.tableName || `Stol ${o.tableId?.number || o.tableNumber || ''}`,
        tableNumber: o.tableId?.number || o.tableNumber,
        waiterId: o.waiterId,
        waiterName: o.waiterId ? `${o.waiterId.firstName || ''} ${o.waiterId.lastName || ''}`.trim() : '',
        items,
        status: o.status,
        createdAt: o.createdAt,
        restaurantId: o.restaurantId
      };
    }).filter(o => o.items.length > 0);

    socketService.emitToRole(restaurantId.toString(), 'cook', 'new_kitchen_order', {
      order: order,
      allOrders: kitchenOrders,
      isNewOrder: true,
      newItems: order.items.map(i => ({ ...i.toObject(), kitchenStatus: i.status }))
    });
    socketService.emitToRole(restaurantId.toString(), 'cook', 'kitchen_orders_updated', kitchenOrders);
    socketService.emitToRole(restaurantId.toString(), 'admin', 'kitchen_orders_updated', kitchenOrders);
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
  getWaiterStats
};
