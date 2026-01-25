const { Order, Table, Notification, Staff } = require('../models');
const socketService = require('../services/socketService');

// Get kitchen orders (items that need to be prepared)
exports.getOrders = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { status } = req.query;

    // Find orders with items that need kitchen attention
    // status = 'pending', 'preparing', 'ready', 'served' yoki undefined (hammasi)
    const kitchenStatuses = status
      ? [status]
      : ['pending', 'preparing', 'ready', 'served'];  // Default: hammasi (pending, preparing, ready, served)

    // Order status filter - ready/served items need broader order statuses
    const orderStatuses = (status === 'ready' || status === 'served' || !status)
      ? ['pending', 'approved', 'preparing', 'ready', 'served']
      : ['pending', 'approved', 'preparing'];

    const orders = await Order.find({
      restaurantId,
      status: { $in: orderStatuses },
      'items.status': { $in: kitchenStatuses }
    })
      .populate('tableId', 'number floor title tableNumber')
      .populate('waiterId', 'firstName lastName')
      .populate('items.foodId', 'name image preparationTime categoryId')
      .sort({ createdAt: 1 });

    // Transform to kitchen-friendly format (cook-web expects these field names)
    const kitchenOrders = orders.map(order => {
      const pendingItems = order.items
        .filter(item => kitchenStatuses.includes(item.status))
        .map(item => ({
          ...item.toObject(),
          // cook-web uses kitchenStatus, backend uses status
          kitchenStatus: item.status,
          name: item.foodId?.name || item.foodName
        }));

      return {
        _id: order._id,
        orderId: order._id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        tableName: order.tableId?.title || order.tableName || `Stol ${order.tableId?.number || order.tableNumber || ''}`,
        tableNumber: order.tableId?.number || order.tableNumber,
        waiterId: order.waiterId,
        waiterName: order.waiterId ? `${order.waiterId.firstName || ''} ${order.waiterId.lastName || ''}`.trim() : '',
        items: pendingItems,
        status: order.status,
        createdAt: order.createdAt,
        notes: order.notes,
        restaurantId: order.restaurantId
      };
    }).filter(order => order.items.length > 0);

    res.json({
      success: true,
      data: kitchenOrders
    });
  } catch (error) {
    next(error);
  }
};

// Get single order for kitchen
exports.getOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const order = await Order.findOne({ _id: id, restaurantId })
      .populate('tableId', 'number floor')
      .populate('waiterId', 'firstName lastName')
      .populate('items.foodId', 'name image preparationTime');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    res.json({
      success: true,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

// Update item kitchen status
exports.updateItemStatus = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { restaurantId, id: cookId } = req.user;
    const { status, readyCount, revertCount } = req.body;

    const validStatuses = ['pending', 'preparing', 'ready', 'served', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
      });
    }

    const order = await Order.findOne({ _id: orderId, restaurantId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // itemId raqam (index) yoki ObjectId bo'lishi mumkin
    // cook-web index yuboradi (0, 1, 2, ...)
    let item;
    let actualItemIndex;
    const itemIndex = parseInt(itemId);
    if (!isNaN(itemIndex) && itemIndex >= 0 && itemIndex < order.items.length) {
      // Index orqali topish
      item = order.items[itemIndex];
      actualItemIndex = itemIndex;
    } else {
      // ObjectId orqali topish
      item = order.items.id(itemId);
      actualItemIndex = order.items.findIndex(i => i._id.toString() === itemId);
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Update item status
    item.status = status;
    if (status === 'preparing') {
      item.startedAt = new Date();
      item.preparedBy = cookId;
      // Revert qilish
      if (revertCount && revertCount > 0) {
        item.readyQuantity = Math.max(0, (item.readyQuantity || 0) - revertCount);
        if (item.readyQuantity === 0) {
          item.status = 'preparing';
        }
      }
    } else if (status === 'ready') {
      item.readyAt = new Date();
      // Partial ready
      if (readyCount && readyCount > 0) {
        item.readyQuantity = (item.readyQuantity || 0) + readyCount;
        // Agar barcha items tayyor bo'lmasa, status hali ready emas
        if (item.readyQuantity < item.quantity) {
          item.status = 'preparing';
        }
      } else {
        item.readyQuantity = item.quantity;
      }
    } else if (status === 'served') {
      item.servedAt = new Date();
    }

    await order.save();

    // Populate for response
    await order.populate('tableId', 'number floor title tableNumber');
    await order.populate('waiterId', 'firstName lastName');
    await order.populate('items.foodId', 'name image categoryId');

    // Get all kitchen orders for cook-web (including ready and served items)
    const rawKitchenOrders = await Order.find({
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready', 'served'] },
      'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] }
    }).populate('items.foodId', 'name price categoryId image')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Transform for cook-web format
    const kitchenOrders = rawKitchenOrders.map(o => {
      const items = o.items
        .filter(i => ['pending', 'preparing', 'ready', 'served'].includes(i.status))
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

    // Emit socket events
    socketService.emitToRestaurant(restaurantId, 'kitchen:item-status-changed', {
      orderId,
      itemId: item._id,
      itemIndex: actualItemIndex,
      status: item.status,
      kitchenStatus: item.status,
      order
    });

    // cook-web uchun kitchen_orders_updated yuborish
    socketService.emitToRole(restaurantId, 'cook', 'kitchen_orders_updated', kitchenOrders);

    // If item is ready OR partial ready, notify waiter
    const itemReadyQty = item.readyQuantity || 0;
    if ((item.status === 'ready' || itemReadyQty > 0) && order.waiterId) {
      const foodName = item.foodId?.name || item.foodName || 'Taom';
      const tableNumber = order.tableId?.number || order.tableId?.tableNumber || order.tableNumber;
      const tableName = order.tableId?.title || order.tableName || `Stol ${tableNumber}`;

      // Create notification and get its ID
      const notification = await Notification.create({
        restaurantId,
        staffId: order.waiterId._id,
        type: 'item_ready',
        title: 'Taom tayyor!',
        message: `${foodName} tayyor - ${tableName}`,
        orderId: order._id,
        tableId: order.tableId?._id || order.tableId,
        priority: 'high'
      });

      // Emit to waiter - Flutter format (order_ready_notification - Flutter shu eventni kutadi)
      socketService.emitToUser(order.waiterId._id.toString(), 'order_ready_notification', {
        notificationId: notification._id.toString(),
        orderId: order._id.toString(),
        tableName,
        tableNumber,
        message: `${foodName} tayyor!`,
        items: [{
          foodName: foodName,
          quantity: item.quantity
        }]
      });

      // Legacy format
      socketService.emitToUser(order.waiterId._id.toString(), 'notification:food-ready', {
        orderId: order._id.toString(),
        itemId: item._id,
        foodName,
        tableNumber
      });
    }

    res.json({
      success: true,
      message: `Item status updated to ${item.status}`,
      data: order
    });
  } catch (error) {
    next(error);
  }
};

// Mark all items in order as preparing
exports.startOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { restaurantId, id: cookId } = req.user;

    const order = await Order.findOne({ _id: orderId, restaurantId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const now = new Date();
    order.items.forEach(item => {
      if (item.status === 'pending') {
        item.status = 'preparing';
        item.startedAt = now;
        item.preparedBy = cookId;
      }
    });

    await order.save();
    await order.populate('tableId', 'number floor');
    await order.populate('items.foodId', 'name image');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'kitchen:order-started', {
      orderId,
      order
    });

    res.json({
      success: true,
      message: 'Order preparation started',
      data: order
    });
  } catch (error) {
    next(error);
  }
};

// Mark all items in order as ready
exports.completeOrder = async (req, res, next) => {
  try {
    const { orderId } = req.params;
    const { restaurantId } = req.user;

    const order = await Order.findOne({ _id: orderId, restaurantId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const now = new Date();
    order.items.forEach(item => {
      if (item.status === 'preparing') {
        item.status = 'ready';
        item.readyAt = now;
      }
    });

    await order.save();
    await order.populate('tableId', 'number floor');
    await order.populate('waiterId', 'firstName lastName');
    await order.populate('items.foodId', 'name image');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'kitchen:order-completed', {
      orderId,
      order
    });

    // Notify waiter
    if (order.waiterId) {
      await Notification.create({
        restaurantId,
        staffId: order.waiterId._id,
        type: 'order_ready',
        title: 'Buyurtma tayyor!',
        message: `Stol ${order.tableId?.number || order.tableNumber} buyurtmasi tayyor`,
        orderId: order._id,
        tableId: order.tableId?._id || order.tableId,
        priority: 'high'
      });

      socketService.emitToUser(order.waiterId._id.toString(), 'notification:order-ready', {
        orderId,
        tableNumber: order.tableId?.number || order.tableNumber
      });
    }

    res.json({
      success: true,
      message: 'Order completed',
      data: order
    });
  } catch (error) {
    next(error);
  }
};

// Get kitchen statistics
exports.getStats = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;

    // Get today's date range
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // Count orders by status
    const orders = await Order.find({
      restaurantId,
      createdAt: { $gte: today, $lt: tomorrow }
    });

    let pendingItems = 0;
    let preparingItems = 0;
    let readyItems = 0;
    let servedItems = 0;
    let totalItems = 0;

    orders.forEach(order => {
      order.items.forEach(item => {
        totalItems++;
        switch (item.status) {
          case 'pending': pendingItems++; break;
          case 'preparing': preparingItems++; break;
          case 'ready': readyItems++; break;
          case 'served': servedItems++; break;
        }
      });
    });

    // Calculate average preparation time
    const completedItems = orders.flatMap(o => o.items)
      .filter(item => item.startedAt && item.readyAt);

    let avgPrepTime = 0;
    if (completedItems.length > 0) {
      const totalPrepTime = completedItems.reduce((sum, item) => {
        return sum + (new Date(item.readyAt) - new Date(item.startedAt));
      }, 0);
      avgPrepTime = Math.round(totalPrepTime / completedItems.length / 1000 / 60); // in minutes
    }

    res.json({
      success: true,
      data: {
        today: {
          totalOrders: orders.length,
          totalItems,
          pendingItems,
          preparingItems,
          readyItems,
          servedItems,
          avgPrepTimeMinutes: avgPrepTime
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Call waiter (from kitchen)
exports.callWaiter = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { orderId, message } = req.body;

    const order = await Order.findOne({ _id: orderId, restaurantId })
      .populate('tableId', 'number floor')
      .populate('waiterId', 'firstName lastName');

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (!order.waiterId) {
      return res.status(400).json({
        success: false,
        message: 'No waiter assigned to this order'
      });
    }

    // Create notification
    await Notification.create({
      restaurantId,
      staffId: order.waiterId._id,
      type: 'waiter_called',
      title: 'Oshxonadan chaqiruv',
      message: message || `Stol ${order.tableId?.number || order.tableNumber} - Oshxona sizni chaqirmoqda`,
      orderId: order._id,
      tableId: order.tableId?._id || order.tableId,
      priority: 'urgent'
    });

    // Emit to waiter
    socketService.emitToUser(order.waiterId._id.toString(), 'notification:kitchen-call', {
      orderId,
      tableNumber: order.tableId?.number || order.tableNumber,
      message
    });

    res.json({
      success: true,
      message: 'Waiter notified'
    });
  } catch (error) {
    next(error);
  }
};
