const { Order, Table, Notification, Staff, Shift } = require('../models');
const socketService = require('../services/socketService');
const mongoose = require('mongoose');

// Get kitchen orders (items that need to be prepared)
exports.getOrders = async (req, res, next) => {
  try {
    const { restaurantId, id: cookId } = req.user;
    const { status, shiftId } = req.query;

    // MUHIM: Frontend dan kelgan shiftId ga ustuvorlik
    let currentShiftId = null;
    if (shiftId && shiftId.trim() !== '') {
      // Frontend aniq shiftId yuborgan
      try {
        currentShiftId = new mongoose.Types.ObjectId(shiftId);
      } catch (err) {
        // Invalid ObjectId - bo'sh qaytarish
        return res.json({
          success: true,
          data: []
        });
      }
    } else {
      // ShiftId berilmagan - aktiv smenani aniqlash
      const activeShift = await Shift.getActiveShift(restaurantId);
      currentShiftId = activeShift?._id;
    }

    // Oshpazning assignedCategories ni olish
    const cook = await Staff.findById(cookId).select('assignedCategories role');
    const cookCategories = cook?.assignedCategories || [];
    const hasCategoryFilter = cook?.role === 'cook' && cookCategories.length > 0;

    // Find orders with items that need kitchen attention
    // status = 'pending', 'preparing', 'ready', 'served' yoki undefined (hammasi)
    const kitchenStatuses = status
      ? [status]
      : ['pending', 'preparing', 'ready', 'served'];  // Default: hammasi (pending, preparing, ready, served)

    // Order status filter - ready/served items need broader order statuses
    // Cancelled orderlarni ham qo'shish - cook panel uchun
    const orderStatuses = (status === 'ready' || status === 'served' || !status)
      ? ['pending', 'approved', 'preparing', 'ready', 'served', 'cancelled']
      : ['pending', 'approved', 'preparing'];

    // Filter bo'yicha - faqat aktiv smena buyurtmalari
    const orderFilter = {
      restaurantId,
      status: { $in: orderStatuses },
      $or: [
        { 'items.status': { $in: kitchenStatuses } },
        { status: 'cancelled' }  // Cancelled orderlar uchun itemlar status dan qat'iy nazar
      ]
    };

    // Agar shiftId bo'lsa, faqat shu smenadagi buyurtmalarni ko'rsatish
    // MUHIM: shiftId bo'lmagan eski orderlarni chiqarmaslik
    if (currentShiftId) {
      orderFilter.shiftId = currentShiftId;
    } else {
      // Hech qanday smena yo'q - shiftId mavjud bo'lgan orderlarni ko'rsatish
      orderFilter.shiftId = { $exists: true, $ne: null };
    }

    const rawOrders = await Order.find(orderFilter)
      .populate('tableId', 'number floor title tableNumber')
      .populate('waiterId', 'firstName lastName')
      .populate('items.foodId', 'name image preparationTime categoryId requireDoubleConfirmation')
      .sort({ createdAt: 1 });

    // MUHIM: Qo'shimcha filter - shiftId bo'lmagan orderlarni chiqarib tashlash
    const orders = rawOrders.filter(order => {
      return order.shiftId && order.shiftId.toString().trim() !== '';
    });

    // Transform to kitchen-friendly format (cook-web expects these field names)
    const kitchenOrders = orders.map(order => {
      // Cancelled orderlar uchun barcha itemlarni ko'rsatish
      const isCancelledOrder = order.status === 'cancelled';

      const pendingItems = order.items
        .map((item, originalIdx) => ({ item, originalIdx })) // Original index ni saqlash
        .filter(({ item }) => {
          // Cancelled orderlar uchun barcha itemlarni ko'rsatish
          if (isCancelledOrder) return true;

          // Status filter
          if (!kitchenStatuses.includes(item.status)) return false;

          // Category filter - faqat oshpazga biriktirilgan kategoriyalar
          if (hasCategoryFilter) {
            const itemCategoryId = item.foodId?.categoryId?.toString();
            if (!itemCategoryId) return false;
            return cookCategories.some(catId => catId.toString() === itemCategoryId);
          }

          return true;
        })
        .map(({ item, originalIdx }) => ({
          ...item.toObject(),
          // cook-web uses kitchenStatus, backend uses status
          kitchenStatus: item.status,
          name: item.foodId?.name || item.foodName,
          requireDoubleConfirmation: item.foodId?.requireDoubleConfirmation || false,
          // categoryId ni saqlash - socket filter uchun kerak
          categoryId: item.foodId?.categoryId?.toString() || null,
          // Original index - cook-web bu index ni ishlatadi item status o'zgartirish uchun
          originalIndex: originalIdx
        }));

      return {
        _id: order._id,
        orderId: order._id,
        orderNumber: order.orderNumber,
        tableId: order.tableId,
        tableName: order.orderType === 'saboy'
          ? `Saboy #${order.saboyNumber || order.orderNumber}`
          : (order.tableId?.title || order.tableName || `Stol ${order.tableId?.number || order.tableNumber || ''}`),
        tableNumber: order.tableId?.number || order.tableNumber,
        waiterId: order.waiterId,
        waiterName: order.waiterId ? `${order.waiterId.firstName || ''} ${order.waiterId.lastName || ''}`.trim() : '',
        items: pendingItems,
        status: order.status,
        createdAt: order.createdAt,
        notes: order.notes,
        restaurantId: order.restaurantId,
        orderType: order.orderType || 'dine-in',
        saboyNumber: order.saboyNumber
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
      .populate('items.foodId', 'name image preparationTime requireDoubleConfirmation');

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
    await order.populate('items.foodId', 'name image categoryId requireDoubleConfirmation');

    // Aktiv smenani olish
    const activeShift = await Shift.getActiveShift(restaurantId);

    // Kitchen orders filter - faqat aktiv smena buyurtmalari
    const kitchenFilter = {
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready', 'served', 'cancelled'] },
      $or: [
        { 'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] } },
        { status: 'cancelled' }  // Cancelled orderlar uchun
      ]
    };

    // Agar aktiv smena bo'lsa, faqat shu smenadagi buyurtmalarni ko'rsatish
    // MUHIM: shiftId bo'lmagan eski orderlarni chiqarmaslik
    if (activeShift) {
      kitchenFilter.shiftId = activeShift._id;
    } else {
      kitchenFilter.shiftId = { $exists: true, $ne: null };
    }

    // Get all kitchen orders for cook-web (including ready, served, and cancelled items)
    const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Transform for cook-web format
    const kitchenOrders = rawKitchenOrders.map(o => {
      // Cancelled orderlar uchun barcha itemlarni ko'rsatish
      const isCancelledOrder = o.status === 'cancelled';

      const items = o.items
        .map((i, originalIdx) => ({ i, originalIdx })) // Original index ni saqlash
        .filter(({ i }) => isCancelledOrder || ['pending', 'preparing', 'ready', 'served'].includes(i.status))
        .map(({ i, originalIdx }) => ({
          ...i.toObject(),
          kitchenStatus: i.status,
          name: i.foodId?.name || i.foodName,
          requireDoubleConfirmation: i.foodId?.requireDoubleConfirmation || false,
          // categoryId ni saqlash - socket filter uchun kerak
          categoryId: i.foodId?.categoryId?.toString() || null,
          // Original index - cook-web bu index ni ishlatadi
          originalIndex: originalIdx
        }));
      return {
        _id: o._id,
        orderId: o._id,
        orderNumber: o.orderNumber,
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
        restaurantId: o.restaurantId,
        orderType: o.orderType || 'dine-in',
        saboyNumber: o.saboyNumber
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

    // cook-web uchun kitchen_orders_updated yuborish (har bir cook uchun filter qilingan)
    await socketService.emitFilteredKitchenOrders(restaurantId, kitchenOrders, 'kitchen_orders_updated');

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

// Start preparing a single item (Boshlandi button)
exports.startItem = async (req, res, next) => {
  try {
    const { orderId, itemId } = req.params;
    const { restaurantId, id: cookId, firstName, lastName } = req.user;
    const cookName = `${firstName || ''} ${lastName || ''}`.trim();

    const order = await Order.findOne({ _id: orderId, restaurantId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // itemId raqam (index) yoki ObjectId bo'lishi mumkin
    let item;
    let actualItemIndex;
    const itemIndex = parseInt(itemId);
    if (!isNaN(itemIndex) && itemIndex >= 0 && itemIndex < order.items.length) {
      item = order.items[itemIndex];
      actualItemIndex = itemIndex;
    } else {
      item = order.items.id(itemId);
      actualItemIndex = order.items.findIndex(i => i._id.toString() === itemId);
    }

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    // Agar allaqachon boshlangan bo'lsa
    if (item.isStarted) {
      return res.status(400).json({
        success: false,
        message: 'Item already started'
      });
    }

    // Itemni boshlash
    item.markStarted(cookId, cookName);
    await order.save();

    // Populate for response
    await order.populate('tableId', 'number floor title tableNumber');
    await order.populate('waiterId', 'firstName lastName');
    await order.populate('items.foodId', 'name image categoryId requireDoubleConfirmation');

    // Socket event - item boshlandi
    socketService.emitToRestaurant(restaurantId, 'kitchen:item-started', {
      orderId,
      itemId: item._id,
      itemIndex: actualItemIndex,
      startedAt: item.startedAt,
      startedBy: cookId,
      startedByName: cookName,
      order
    });

    // Aktiv smenani olish
    const activeShift = await Shift.getActiveShift(restaurantId);

    // Kitchen orders filter - faqat aktiv smena buyurtmalari
    const kitchenFilter = {
      restaurantId,
      status: { $in: ['pending', 'approved', 'preparing', 'ready', 'served', 'cancelled'] },
      $or: [
        { 'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] } },
        { status: 'cancelled' }
      ]
    };

    // Agar aktiv smena bo'lsa, faqat shu smenadagi buyurtmalarni ko'rsatish
    // MUHIM: shiftId bo'lmagan eski orderlarni chiqarmaslik
    if (activeShift) {
      kitchenFilter.shiftId = activeShift._id;
    } else {
      kitchenFilter.shiftId = { $exists: true, $ne: null };
    }

    // Kitchen orders yangilash
    const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image requireDoubleConfirmation')
      .populate('tableId', 'title tableNumber number')
      .populate('waiterId', 'firstName lastName')
      .sort({ createdAt: -1 });

    const kitchenOrders = rawKitchenOrders.map(o => {
      const isCancelledOrder = o.status === 'cancelled';
      const items = o.items
        .map((i, originalIdx) => ({ i, originalIdx }))
        .filter(({ i }) => isCancelledOrder || ['pending', 'preparing', 'ready', 'served'].includes(i.status))
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
        restaurantId: o.restaurantId,
        orderType: o.orderType || 'dine-in',
        saboyNumber: o.saboyNumber
      };
    }).filter(o => o.items.length > 0);

    // cook-web uchun kitchen_orders_updated yuborish
    await socketService.emitFilteredKitchenOrders(restaurantId, kitchenOrders, 'kitchen_orders_updated');

    res.json({
      success: true,
      message: 'Item preparation started',
      data: {
        orderId,
        itemId: item._id,
        itemIndex: actualItemIndex,
        startedAt: item.startedAt,
        startedBy: cookId,
        startedByName: cookName,
        order
      }
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
    await order.populate('items.foodId', 'name image requireDoubleConfirmation');

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
    await order.populate('items.foodId', 'name image requireDoubleConfirmation');

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
