const { Server } = require('socket.io');
const { verifyToken } = require('../middleware/auth');
const { Staff } = require('../models');
const config = require('../config/env');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // staffId -> socketId
    // Takroriy so'rovlarni oldini olish: key -> timestamp
    this._recentEvents = new Map();
    // Eskirgan yozuvlarni tozalash (har 60 soniyada)
    setInterval(() => {
      const now = Date.now();
      for (const [key, timestamp] of this._recentEvents) {
        if (now - timestamp > 30000) this._recentEvents.delete(key);
      }
    }, 60000);
  }

  /**
   * Takroriy eventni tekshirish
   * @param {string} key - unikal kalit
   * @param {number} windowMs - bloklash oynasi (ms)
   * @returns {boolean} true = takroriy (bloklanadi)
   */
  _isDuplicateEvent(key, windowMs = 5000) {
    const now = Date.now();
    const lastTime = this._recentEvents.get(key);
    if (lastTime && (now - lastTime) < windowMs) {
      console.log(`Socket: Duplicate event blocked: ${key} (${now - lastTime}ms ago)`);
      return true;
    }
    this._recentEvents.set(key, now);
    return false;
  }

  /**
   * Initialize socket server
   */
  init(server) {
    this.io = new Server(server, {
      cors: {
        origin: config.CORS_ORIGIN,
        methods: ['GET', 'POST']
      }
    });

    this.io.on('connection', (socket) => {
      this.handleConnection(socket);
    });

    console.log('Socket.io initialized');
    return this.io;
  }

  /**
   * Handle new connection
   */
  async handleConnection(socket) {
    if (config.ENABLE_SOCKET_LOGGING) {
      console.log('Socket connected:', socket.id);
    }

    // Auto-authenticate if token provided in handshake auth
    if (socket.handshake.auth && socket.handshake.auth.token) {
      await this.handleAuthenticate(socket, { token: socket.handshake.auth.token });
    }

    // Authentication
    socket.on('authenticate', async (data) => {
      await this.handleAuthenticate(socket, data);
    });

    // Legacy events (backward compatibility)
    socket.on('waiter_connect', async (data) => {
      await this.handleWaiterConnect(socket, data);
    });

    socket.on('cook_connect', async (data) => {
      await this.handleCookConnect(socket, data);
    });

    socket.on('admin_connect', async (data) => {
      await this.handleAdminConnect(socket, data);
    });

    socket.on('cashier_connect', async (data) => {
      await this.handleCashierConnect(socket, data);
    });

    socket.on('join_restaurant', async (data) => {
      await this.handleJoinRestaurant(socket, data);
    });

    // Order events
    socket.on('post_order', async (data) => {
      await this.handlePostOrder(socket, data);
    });

    socket.on('order_served', async (data) => {
      await this.handleOrderServed(socket, data);
    });

    socket.on('approve_order', async (data) => {
      await this.handleApproveOrder(socket, data);
    });

    socket.on('reject_order', async (data) => {
      await this.handleRejectOrder(socket, data);
    });

    // Add items to existing order
    socket.on('add_order_items', async (data) => {
      await this.handleAddOrderItems(socket, data);
    });

    // Bell/call waiter
    socket.on('call_waiter', async (data) => {
      await this.handleCallWaiter(socket, data);
    });

    // Request print check from waiter app
    socket.on('request_print_check', async (data) => {
      await this.handleRequestPrintCheck(socket, data);
    });

    // Disconnect
    socket.on('disconnect', async () => {
      await this.handleDisconnect(socket);
    });
  }

  /**
   * Handle authentication
   */
  async handleAuthenticate(socket, data) {
    try {
      const { token } = data;
      const user = await verifyToken(token);

      if (!user) {
        socket.emit('auth_error', { message: 'Invalid token' });
        return;
      }

      // Store socket info
      socket.userId = user.id;
      socket.restaurantId = user.restaurantId.toString();
      socket.role = user.role;
      socket.fullName = user.fullName;

      // Join rooms
      socket.join(`restaurant:${socket.restaurantId}`);
      socket.join(`${socket.role}:${socket.restaurantId}`);
      socket.join(`user:${socket.userId}`);

      // Track connected user
      this.connectedUsers.set(socket.userId.toString(), socket.id);

      // Update staff online status
      await Staff.findByIdAndUpdate(user.id, {
        isOnline: true,
        socketId: socket.id,
        lastSeenAt: new Date()
      });

      socket.emit('authenticated', {
        userId: user.id,
        role: user.role,
        restaurantId: socket.restaurantId
      });

      // Notify others
      this.emitToRestaurant(socket.restaurantId, 'staff:online', {
        staffId: user.id,
        role: user.role,
        fullName: user.fullName
      });

      if (config.ENABLE_SOCKET_LOGGING) {
        console.log(`User authenticated: ${user.fullName} (${user.role})`);
      }
    } catch (error) {
      console.error('Socket auth error:', error);
      socket.emit('auth_error', { message: 'Authentication failed' });
    }
  }

  /**
   * Handle legacy waiter_connect
   */
  async handleWaiterConnect(socket, data) {
    const { waiterId, restaurantId } = data;

    socket.userId = waiterId;
    socket.restaurantId = restaurantId;
    socket.role = 'waiter';

    socket.join(`restaurant:${restaurantId}`);
    socket.join(`waiter:${restaurantId}`);
    socket.join(`user:${waiterId}`);

    this.connectedUsers.set(waiterId, socket.id);

    await Staff.findByIdAndUpdate(waiterId, {
      isOnline: true,
      socketId: socket.id,
      lastSeenAt: new Date()
    });

    socket.emit('connection_established', {
      waiterId,
      restaurantId,
      message: 'Connected successfully'
    });
  }

  /**
   * Handle cook_connect
   */
  async handleCookConnect(socket, data) {
    const { cookId, restaurantId } = data;

    socket.userId = cookId;
    socket.restaurantId = restaurantId;
    socket.role = 'cook';

    socket.join(`restaurant:${restaurantId}`);
    socket.join(`cook:${restaurantId}`);
    socket.join(`user:${cookId}`);

    this.connectedUsers.set(cookId, socket.id);

    // Update cook status to 'working' and isOnline to true
    await Staff.findByIdAndUpdate(cookId, {
      isOnline: true,
      status: 'working',
      socketId: socket.id,
      lastSeenAt: new Date()
    });

    socket.emit('connection_established', {
      cookId,
      restaurantId,
      message: 'Cook connected successfully'
    });

    if (config.ENABLE_SOCKET_LOGGING) {
      console.log(`Cook connected: ${cookId} to restaurant ${restaurantId}`);
    }
  }

  /**
   * Handle admin_connect
   */
  async handleAdminConnect(socket, data) {
    const { restaurantId, role } = data;

    socket.restaurantId = restaurantId;
    socket.role = 'admin';

    socket.join(`restaurant:${restaurantId}`);
    socket.join(`admin:${restaurantId}`);

    socket.emit('connection_established', {
      restaurantId,
      role: 'admin',
      message: 'Admin connected successfully'
    });

    if (config.ENABLE_SOCKET_LOGGING) {
      console.log(`Admin connected to restaurant ${restaurantId}`);
    }
  }

  /**
   * Handle cashier_connect
   */
  async handleCashierConnect(socket, data) {
    const { cashierId, restaurantId } = data;

    socket.userId = cashierId;
    socket.restaurantId = restaurantId;
    socket.role = 'cashier';

    socket.join(`restaurant:${restaurantId}`);
    socket.join(`cashier:${restaurantId}`);
    if (cashierId) {
      socket.join(`user:${cashierId}`);
      this.connectedUsers.set(cashierId, socket.id);
    }

    socket.emit('connection_established', {
      cashierId,
      restaurantId,
      message: 'Cashier connected successfully'
    });

    if (config.ENABLE_SOCKET_LOGGING) {
      console.log(`Cashier connected: ${cashierId} to restaurant ${restaurantId}`);
    }
  }

  /**
   * Handle join_restaurant
   */
  async handleJoinRestaurant(socket, data) {
    const { restaurantId, staffId } = data;

    socket.join(`restaurant:${restaurantId}`);

    if (staffId) {
      socket.userId = staffId;
      socket.join(`user:${staffId}`);
      this.connectedUsers.set(staffId, socket.id);
    }
  }

  /**
   * Handle post_order (waiter creates order via socket)
   */
  async handlePostOrder(socket, data) {
    try {
      const { Order, Table, Shift } = require('../models');

      // Takroriy order yaratishni bloklash
      const staffId = socket.userId || data.waiterId || 'unknown';
      const dedupeKey = `post_order:${staffId}:${data.tableId}:${(data.selectFoods || []).length}:${data.totalPrice}`;
      if (this._isDuplicateEvent(dedupeKey)) {
        console.log('handlePostOrder: Duplicate order blocked for', dedupeKey);
        return;
      }

      // MUHIM: Aktiv smenani tekshirish
      const activeShift = await Shift.getActiveShift(data.restaurantId);
      if (!activeShift) {
        // Aktiv smena yo'q - xatolik qaytarish
        socket.emit('order_error', {
          success: false,
          message: 'Aktiv smena yo\'q. Buyurtma yaratish uchun admin smenani ochishi kerak.',
          code: 'NO_ACTIVE_SHIFT'
        });
        return;
      }

      const orderNumber = await Order.getNextOrderNumber(data.restaurantId);

      const order = new Order({
        restaurantId: data.restaurantId,
        shiftId: activeShift._id, // MUHIM: ShiftId qo'shildi
        orderNumber,
        orderType: 'dine-in',
        tableId: data.tableId,
        tableName: data.tableName,
        tableNumber: data.tableNumber,
        items: data.selectFoods.map(item => ({
          foodId: item._id || item.foodId,
          foodName: item.foodName || item.name,
          categoryId: item.category,
          quantity: item.quantity || 1,
          price: item.price
        })),
        waiterId: data.waiterId,
        waiterName: data.waiterName,
        waiterApproved: true, // Waiter-created orders are auto-approved
        approvedAt: new Date(),
        source: 'waiter',
        surcharge: data.surcharge || 0
      });

      await order.save();

      // Increment daily order count for each food (auto stop-list)
      const Food = require('../models/food');
      for (const item of order.items) {
        if (item.foodId) {
          const food = await Food.findById(item.foodId);
          if (food && food.autoStopListEnabled && food.dailyOrderLimit > 0) {
            await food.incrementDailyOrderCount(item.quantity || 1);
          }
        }
      }

      // Update table status
      if (data.tableId) {
        await Table.findByIdAndUpdate(data.tableId, {
          status: 'occupied',
          activeOrderId: order._id
        });
      }

      // Emit to all clients
      this.emitToRestaurant(data.restaurantId, 'order:created', { order });

      // Also emit legacy events for backward compatibility
      this.emitToRestaurant(data.restaurantId, 'new_order', { order });

      // Cook uchun barcha kitchen orderlarni yuborish (including ready items)
      try {
        const rawKitchenOrders = await Order.find({
          restaurantId: data.restaurantId,
          shiftId: activeShift._id, // MUHIM: Faqat joriy smena buyurtmalari
          status: { $in: ['pending', 'preparing', 'approved', 'ready', 'served', 'paid'] },
          'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] }
        }).populate('items.foodId', 'name price categoryId image')
          .populate('tableId', 'title tableNumber number')
          .populate('waiterId', 'firstName lastName')
          .sort({ createdAt: -1 });

        // Transform for cook-web format
        const kitchenOrders = rawKitchenOrders.map(o => {
          const items = o.items
            .map((i, originalIdx) => ({ i, originalIdx })) // Original index ni saqlash
            .filter(({ i }) => ['pending', 'preparing', 'ready', 'served'].includes(i.status))
            .map(({ i, originalIdx }) => ({
              ...i.toObject(),
              kitchenStatus: i.status,
              name: i.foodId?.name || i.foodName,
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

        // new_kitchen_order event - har bir cook uchun filter qilingan
        // Admin uchun barcha itemlar
        this.emitToRole(data.restaurantId, 'admin', 'new_kitchen_order', {
          order: order,
          allOrders: kitchenOrders,
          isNewOrder: true,
          newItems: order.items.map((i, idx) => ({ ...i.toObject(), kitchenStatus: i.status, originalIndex: idx }))
        });

        // Har bir cook uchun filter qilingan newItems va allOrders
        await this.emitFilteredNewKitchenOrder(data.restaurantId, order, kitchenOrders);

        // kitchen_orders_updated ham yuborish (har bir cook uchun filter qilingan)
        await this.emitFilteredKitchenOrders(data.restaurantId, kitchenOrders, 'kitchen_orders_updated');
      } catch (err) {
        console.error('Error fetching kitchen orders for cook:', err);
      }

      // Admin panel uchun food stats yangilash
      this.emitToRole(data.restaurantId, 'admin', 'food_stats_updated', {});

      socket.emit('post_order_success', { order });

    } catch (error) {
      console.error('Post order error:', error);
      socket.emit('post_order_error', { message: error.message });
    }
  }

  /**
   * Handle order_served
   */
  async handleOrderServed(socket, data) {
    try {
      const { Order } = require('../models');
      const { orderId } = data;

      const order = await Order.findById(orderId);
      if (!order) {
        socket.emit('error', { message: 'Order not found' });
        return;
      }

      const restaurantId = order.restaurantId;

      // Mark all items as served
      order.items.forEach(item => {
        if (!item.isDeleted) {
          item.status = 'served';
          item.servedAt = new Date();
        }
      });

      order.status = 'served';
      order.servedAt = new Date();
      await order.save();

      this.emitToRestaurant(restaurantId.toString(), 'order:updated', {
        order,
        action: 'served'
      });

      // Cook uchun kitchen_orders_updated yuborish (served itemlar ham qoladi - cook ko'rishi uchun)
      try {
        // Aktiv smenani olish
        const { Shift } = require('../models');
        const activeShift = await Shift.getActiveShift(restaurantId);

        // MUHIM: Aktiv smena yo'q bo'lsa, bo'sh data yuborish va query qilmaslik
        if (!activeShift) {
          await this.emitFilteredKitchenOrders(restaurantId.toString(), [], 'kitchen_orders_updated');
        } else {
          // Kitchen orders filter - faqat aktiv smena buyurtmalari
          const kitchenFilter = {
            restaurantId,
            shiftId: activeShift._id,
            status: { $in: ['pending', 'approved', 'preparing', 'ready', 'served', 'paid'] },
            'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] }
          };

          const rawKitchenOrders = await Order.find(kitchenFilter).populate('items.foodId', 'name price categoryId image')
            .populate('tableId', 'title tableNumber number')
            .populate('waiterId', 'firstName lastName')
            .sort({ createdAt: -1 });

          const kitchenOrders = rawKitchenOrders.map(o => {
            const items = o.items
              .map((i, originalIdx) => ({ i, originalIdx })) // Original index ni saqlash
              .filter(({ i }) => ['pending', 'preparing', 'ready', 'served'].includes(i.status))
              .map(({ i, originalIdx }) => ({
                ...i.toObject(),
                kitchenStatus: i.status,
                name: i.foodId?.name || i.foodName,
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

          // Har bir cook uchun filter qilingan
          await this.emitFilteredKitchenOrders(restaurantId.toString(), kitchenOrders, 'kitchen_orders_updated');
        }
      } catch (err) {
        console.error('Error sending kitchen orders after serve:', err);
      }

      socket.emit('order_served_confirmed', { orderId });

    } catch (error) {
      console.error('Order served error:', error);
      socket.emit('error', { message: error.message });
    }
  }

  /**
   * Handle approve_order
   */
  async handleApproveOrder(socket, data) {
    try {
      const { Order } = require('../models');
      const { orderId, waiterId } = data;

      const order = await Order.findById(orderId);
      if (!order) {
        socket.emit('approve_order_response', { success: false, message: 'Order not found' });
        return;
      }

      order.approve(waiterId);
      await order.save();

      this.emitToRestaurant(order.restaurantId.toString(), 'order:approved', { order });
      this.emitToRestaurant(order.restaurantId.toString(), 'order:updated', {
        order,
        action: 'approved'
      });

      socket.emit('approve_order_response', { success: true, order });

    } catch (error) {
      console.error('Approve order error:', error);
      socket.emit('approve_order_response', { success: false, message: error.message });
    }
  }

  /**
   * Handle reject_order
   */
  async handleRejectOrder(socket, data) {
    try {
      const { Order } = require('../models');
      const { orderId, waiterId, reason } = data;

      const order = await Order.findById(orderId);
      if (!order) {
        socket.emit('reject_order_response', { success: false, message: 'Order not found' });
        return;
      }

      order.reject(waiterId, reason);
      await order.save();

      this.emitToRestaurant(order.restaurantId.toString(), 'order:rejected', {
        orderId,
        reason
      });

      socket.emit('reject_order_response', { success: true, orderId });

    } catch (error) {
      console.error('Reject order error:', error);
      socket.emit('reject_order_response', { success: false, message: error.message });
    }
  }

  /**
   * Handle add_order_items - new items added to existing order
   */
  async handleAddOrderItems(socket, data) {
    try {
      const { Order } = require('../models');
      const { orderId, restaurantId, newItems, tableName, tableNumber, waiterName, waiterId } = data;

      console.log('add_order_items event received:', { orderId, restaurantId, newItemsCount: newItems?.length });

      // Takroriy item qo'shishni bloklash
      const staffId = socket.userId || waiterId || 'unknown';
      const dedupeKey = `add_items:${staffId}:${orderId}:${(newItems || []).length}`;
      if (this._isDuplicateEvent(dedupeKey)) {
        console.log('handleAddOrderItems: Duplicate add_items blocked for', dedupeKey);
        return;
      }

      if (!orderId || !restaurantId || !newItems || newItems.length === 0) {
        console.log('add_order_items: Missing required data');
        socket.emit('add_order_items_error', { message: 'Missing required data' });
        return;
      }

      // Get the order first (without populate to modify)
      const order = await Order.findById(orderId);

      if (!order) {
        console.log('add_order_items: Order not found:', orderId);
        socket.emit('add_order_items_error', { message: 'Order not found' });
        return;
      }

      // Add new items to the order - CRITICAL FIX!
      const itemsToAdd = newItems.map(item => ({
        foodId: item.foodId || item._id,
        foodName: item.foodName || item.name,
        categoryId: item.category || item.categoryId,
        quantity: item.quantity || 1,
        price: item.price || 0,
        status: 'pending',
        addedAt: new Date()
      }));

      // Push new items to order
      order.items.push(...itemsToAdd);

      // Save the order
      await order.save();
      console.log('add_order_items: Items saved to database, new items count:', itemsToAdd.length);

      // Increment daily order count for each food (auto stop-list)
      const Food = require('../models/food');
      for (const item of itemsToAdd) {
        if (item.foodId) {
          const food = await Food.findById(item.foodId);
          if (food && food.autoStopListEnabled && food.dailyOrderLimit > 0) {
            await food.incrementDailyOrderCount(item.quantity || 1);
          }
        }
      }

      // Now get the fully populated order for emitting
      const populatedOrder = await Order.findById(orderId)
        .populate('items.foodId', 'name price categoryId image')
        .populate('tableId', 'title tableNumber number')
        .populate('waiterId', 'firstName lastName');

      // Emit success to the waiter
      socket.emit('add_order_items_success', {
        orderId,
        itemsAdded: itemsToAdd.length,
        message: 'Items added successfully'
      });

      // Get all kitchen orders
      // Aktiv smenani olish
      const { Shift } = require('../models');
      const activeShift = await Shift.getActiveShift(restaurantId);

      // Emit order:updated to all clients (bu har doim yuborilishi kerak)
      this.emitToRestaurant(restaurantId, 'order:updated', {
        order: populatedOrder,
        action: 'items_added'
      });

      // MUHIM: Aktiv smena yo'q bo'lsa, bo'sh data yuborish va query qilmaslik
      if (!activeShift) {
        await this.emitFilteredKitchenOrders(restaurantId, [], 'kitchen_orders_updated');
        console.log('add_order_items: No active shift, emitted empty kitchen orders');
      } else {
        // Kitchen orders filter - faqat aktiv smena buyurtmalari
        const kitchenFilter = {
          restaurantId,
          shiftId: activeShift._id,
          status: { $in: ['pending', 'preparing', 'approved', 'ready', 'served', 'paid'] },
          'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] }
        };

        const rawKitchenOrders = await Order.find(kitchenFilter)
          .populate('items.foodId', 'name price categoryId image')
          .populate('tableId', 'title tableNumber number')
          .populate('waiterId', 'firstName lastName')
          .sort({ createdAt: -1 });

        // Transform for cook-web format
        const kitchenOrders = rawKitchenOrders.map(o => {
          const items = o.items
            .map((i, originalIdx) => ({ i, originalIdx }))
            .filter(({ i }) => ['pending', 'preparing', 'ready', 'served'].includes(i.status))
            .map(({ i, originalIdx }) => ({
              ...i.toObject(),
              kitchenStatus: i.status,
              name: i.foodId?.name || i.foodName,
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

        // Format newItems for cook panel - use the added items with their original indices
        const startIndex = populatedOrder.items.length - itemsToAdd.length;
        const formattedNewItems = itemsToAdd.map((item, idx) => ({
          foodId: item.foodId,
          foodName: item.foodName,
          categoryId: item.categoryId,
          quantity: item.quantity,
          price: item.price,
          status: 'pending',
          kitchenStatus: 'pending',
          originalIndex: startIndex + idx
        }));

        console.log('add_order_items: Emitting to cooks, newItems:', formattedNewItems.length);

        // Emit to admin
        this.emitToRole(restaurantId, 'admin', 'new_kitchen_order', {
          order: populatedOrder,
          allOrders: kitchenOrders,
          isNewOrder: false,
          newItems: formattedNewItems
        });

        // Emit to cooks (filtered by categories)
        await this.emitFilteredNewKitchenOrderForAddedItems(restaurantId, populatedOrder, kitchenOrders, formattedNewItems);

        // Also emit kitchen_orders_updated
        await this.emitFilteredKitchenOrders(restaurantId, kitchenOrders, 'kitchen_orders_updated');

        // Admin panel uchun food stats yangilash
        this.emitToRole(restaurantId, 'admin', 'food_stats_updated', {});

        console.log('add_order_items: Events emitted successfully');
      }

    } catch (error) {
      console.error('Add order items error:', error);
    }
  }

  /**
   * Handle call_waiter (bell)
   */
  async handleCallWaiter(socket, data) {
    try {
      const { Table, Notification } = require('../models');
      const { tableId, restaurantId } = data;

      const table = await Table.findById(tableId);
      if (!table) return;

      // Create notification for waiter
      if (table.assignedWaiterId) {
        await Notification.createWaiterCalledNotification(table);

        // Emit to specific waiter
        this.emitToUser(table.assignedWaiterId.toString(), 'waiter:called', {
          tableId,
          tableName: table.title,
          tableNumber: table.tableNumber
        });
      }

      // Also emit to all waiters in restaurant
      this.emitToRole(restaurantId, 'waiter', 'waiter_called', {
        tableId,
        tableName: table.title,
        tableNumber: table.tableNumber
      });

    } catch (error) {
      console.error('Call waiter error:', error);
    }
  }

  /**
   * Handle request_print_check - waiter requests to print check for an order
   */
  async handleRequestPrintCheck(socket, data) {
    try {
      const { Order } = require('../models');
      const { orderId, restaurantId, waiterId, waiterName } = data;

      console.log('request_print_check event received:', { orderId, restaurantId, waiterId });

      if (!orderId || !restaurantId) {
        socket.emit('print_check_error', {
          success: false,
          message: 'Order ID va Restaurant ID kerak'
        });
        return;
      }

      // Get the order with all necessary data
      const order = await Order.findById(orderId)
        .populate('items.foodId', 'name price categoryId')
        .populate('tableId', 'title tableNumber number')
        .populate('waiterId', 'firstName lastName');

      if (!order) {
        socket.emit('print_check_error', {
          success: false,
          message: 'Buyurtma topilmadi'
        });
        return;
      }

      // Calculate totals
      const subtotal = order.items
        .filter(item => item.status !== 'cancelled' && !item.isDeleted)
        .reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const serviceFee = Math.round(subtotal * 0.1); // 10% service fee
      const total = subtotal + serviceFee;

      // Format order data for printing
      const printData = {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        tableName: order.orderType === 'saboy'
          ? `Saboy #${order.saboyNumber || order.orderNumber}`
          : (order.tableId?.title || order.tableName || `Stol ${order.tableId?.number || order.tableNumber || ''}`),
        tableNumber: order.tableId?.number || order.tableNumber,
        waiterName: order.waiterId
          ? `${order.waiterId.firstName || ''} ${order.waiterId.lastName || ''}`.trim()
          : (order.waiterName || waiterName || ''),
        items: order.items
          .filter(item => item.status !== 'cancelled' && !item.isDeleted)
          .map(item => ({
            name: item.foodId?.name || item.foodName,
            quantity: item.quantity,
            price: item.price
          })),
        subtotal,
        serviceFee,
        total,
        orderType: order.orderType || 'dine-in',
        createdAt: order.createdAt,
        requestedBy: waiterName || 'Ofitsiant',
        requestedAt: new Date().toISOString()
      };

      console.log('Emitting print_check_requested to cashiers:', printData.orderId);

      // Emit to cashiers to print the check
      this.emitToRole(restaurantId, 'cashier', 'print_check_requested', printData);

      // Also emit to admin
      this.emitToRole(restaurantId, 'admin', 'print_check_requested', printData);

      // Confirm to waiter that request was sent
      socket.emit('print_check_sent', {
        success: true,
        orderId: order._id.toString(),
        message: 'Chek chiqarish so\'rovi yuborildi'
      });

    } catch (error) {
      console.error('Request print check error:', error);
      socket.emit('print_check_error', {
        success: false,
        message: error.message || 'Xatolik yuz berdi'
      });
    }
  }

  /**
   * Handle disconnect
   */
  async handleDisconnect(socket) {
    if (socket.userId) {
      this.connectedUsers.delete(socket.userId.toString());

      await Staff.findByIdAndUpdate(socket.userId, {
        isOnline: false,
        socketId: null,
        lastSeenAt: new Date()
      });

      if (socket.restaurantId) {
        this.emitToRestaurant(socket.restaurantId, 'staff:offline', {
          staffId: socket.userId
        });
      }
    }

    if (config.ENABLE_SOCKET_LOGGING) {
      console.log('Socket disconnected:', socket.id);
    }
  }

  // ==================== EMIT METHODS ====================

  /**
   * Emit to all clients in restaurant
   */
  emitToRestaurant(restaurantId, event, data) {
    if (!this.io) return;

    // Array bo'lsa to'g'ridan-to'g'ri yuborish, object bo'lsa timestamp qo'shish
    const payload = Array.isArray(data) ? data : { ...data, timestamp: Date.now() };
    this.io.to(`restaurant:${restaurantId}`).emit(event, payload);

    if (config.ENABLE_SOCKET_LOGGING) {
      console.log(`[EMIT] ${event} -> restaurant:${restaurantId}`);
    }
  }

  /**
   * Emit to specific role in restaurant
   */
  emitToRole(restaurantId, role, event, data) {
    if (!this.io) return;

    // Array bo'lsa to'g'ridan-to'g'ri yuborish, object bo'lsa timestamp qo'shish
    const payload = Array.isArray(data) ? data : { ...data, timestamp: Date.now() };
    this.io.to(`${role}:${restaurantId}`).emit(event, payload);

    if (config.ENABLE_SOCKET_LOGGING) {
      console.log(`[EMIT] ${event} -> ${role}:${restaurantId}`);
    }
  }

  /**
   * Emit to specific user
   */
  emitToUser(userId, event, data) {
    if (!this.io) return;

    // Array bo'lsa to'g'ridan-to'g'ri yuborish, object bo'lsa timestamp qo'shish
    const payload = Array.isArray(data) ? data : { ...data, timestamp: Date.now() };
    this.io.to(`user:${userId}`).emit(event, payload);

    if (config.ENABLE_SOCKET_LOGGING) {
      console.log(`[EMIT] ${event} -> user:${userId}`);
    }
  }

  /**
   * Get socket by user ID
   */
  getSocketByUserId(userId) {
    const socketId = this.connectedUsers.get(userId.toString());
    return socketId ? this.io.sockets.sockets.get(socketId) : null;
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId) {
    return this.connectedUsers.has(userId.toString());
  }

  /**
   * Get online users in restaurant
   */
  getOnlineUsersInRestaurant(restaurantId) {
    const room = this.io.sockets.adapter.rooms.get(`restaurant:${restaurantId}`);
    return room ? room.size : 0;
  }

  /**
   * Emit filtered kitchen orders to each cook based on their assignedCategories
   * Admin gets all orders, cooks get filtered by their categories
   */
  async emitFilteredKitchenOrders(restaurantId, kitchenOrders, event = 'kitchen_orders_updated') {
    if (!this.io) return;

    // Admin uchun - barcha orderlar
    this.emitToRole(restaurantId, 'admin', event, kitchenOrders);

    // Har bir cook uchun filter qilingan orderlar
    try {
      // Find cooks who are online (status check relaxed - working or undefined)
      const cooks = await Staff.find({
        restaurantId,
        role: 'cook',
        isOnline: true,
        $or: [
          { status: 'working' },
          { status: { $exists: false } },
          { status: null }
        ]
      }).select('_id assignedCategories');

      for (const cook of cooks) {
        const cookCategories = cook.assignedCategories || [];
        const hasCategoryFilter = cookCategories.length > 0;

        let filteredOrders;
        if (hasCategoryFilter) {
          // Filter orders - faqat oshpazga biriktirilgan kategoriyalar
          filteredOrders = kitchenOrders.map(order => {
            const filteredItems = order.items.filter(item => {
              const itemCategoryId = item.foodId?.categoryId?.toString() || item.categoryId?.toString();
              if (!itemCategoryId) return false;
              return cookCategories.some(catId => catId.toString() === itemCategoryId);
            });
            return { ...order, items: filteredItems };
          }).filter(order => order.items.length > 0);
        } else {
          // Agar kategoriya biriktirilmagan bo'lsa - barcha orderlar
          filteredOrders = kitchenOrders;
        }

        // Faqat shu oshpazga yuborish
        this.emitToUser(cook._id.toString(), event, filteredOrders);
      }
    } catch (err) {
      console.error('Error emitting filtered kitchen orders:', err);
      // Fallback - barcha cook'larga yuborish
      this.emitToRole(restaurantId, 'cook', event, kitchenOrders);
    }
  }

  /**
   * Emit filtered new_kitchen_order event to each cook based on their assignedCategories
   * newItems should only contain items from categories assigned to that cook
   */
  async emitFilteredNewKitchenOrder(restaurantId, order, allKitchenOrders) {
    if (!this.io) return;

    try {
      // Find cooks who are online (status check relaxed - working or undefined)
      const cooks = await Staff.find({
        restaurantId,
        role: 'cook',
        isOnline: true,
        $or: [
          { status: 'working' },
          { status: { $exists: false } },
          { status: null }
        ]
      }).select('_id assignedCategories');

      for (const cook of cooks) {
        const cookCategories = cook.assignedCategories || [];
        const hasCategoryFilter = cookCategories.length > 0;

        let filteredNewItems;
        let filteredAllOrders;

        if (hasCategoryFilter) {
          // Filter newItems - faqat oshpazga biriktirilgan kategoriyalar
          // Original index ni saqlash uchun map qilib, keyin filter qilish
          filteredNewItems = order.items
            .map((item, idx) => ({ item, originalIndex: idx }))
            .filter(({ item }) => {
              const itemCategoryId = item.categoryId?.toString() || item.foodId?.categoryId?.toString();
              if (!itemCategoryId) return false;
              return cookCategories.some(catId => catId.toString() === itemCategoryId);
            })
            .map(({ item, originalIndex }) => ({
              ...(item.toObject ? item.toObject() : item),
              kitchenStatus: item.status || 'pending',
              originalIndex
            }));

          // Filter allOrders
          filteredAllOrders = allKitchenOrders.map(o => {
            const filteredItems = o.items.filter(item => {
              const itemCategoryId = item.foodId?.categoryId?.toString() || item.categoryId?.toString();
              if (!itemCategoryId) return false;
              return cookCategories.some(catId => catId.toString() === itemCategoryId);
            });
            return { ...o, items: filteredItems };
          }).filter(o => o.items.length > 0);
        } else {
          // Agar kategoriya biriktirilmagan bo'lsa - barcha itemlar
          filteredNewItems = order.items.map((item, idx) => ({
            ...(item.toObject ? item.toObject() : item),
            kitchenStatus: item.status || 'pending',
            originalIndex: idx
          }));
          filteredAllOrders = allKitchenOrders;
        }

        // Faqat shu oshpazga tegishli itemlar bo'lsa yuborish
        if (filteredNewItems.length > 0) {
          this.emitToUser(cook._id.toString(), 'new_kitchen_order', {
            order: order,
            allOrders: filteredAllOrders,
            isNewOrder: true,
            newItems: filteredNewItems
          });
        }
      }
    } catch (err) {
      console.error('Error emitting filtered new_kitchen_order:', err);
      // Fallback - barcha cook'larga yuborish (lekin bu ideal emas)
      this.emitToRole(restaurantId, 'cook', 'new_kitchen_order', {
        order: order,
        allOrders: allKitchenOrders,
        isNewOrder: true,
        newItems: order.items.map((item, idx) => ({
          ...(item.toObject ? item.toObject() : item),
          kitchenStatus: item.status || 'pending',
          originalIndex: idx
        }))
      });
    }
  }

  /**
   * Emit filtered new_kitchen_order for added items (not new order)
   * Similar to emitFilteredNewKitchenOrder but for added items to existing order
   */
  async emitFilteredNewKitchenOrderForAddedItems(restaurantId, order, allKitchenOrders, newItems) {
    if (!this.io) return;

    try {
      const cooks = await Staff.find({
        restaurantId,
        role: 'cook',
        isOnline: true,
        $or: [
          { status: 'working' },
          { status: { $exists: false } },
          { status: null }
        ]
      }).select('_id assignedCategories');

      for (const cook of cooks) {
        const cookCategories = cook.assignedCategories || [];
        const hasCategoryFilter = cookCategories.length > 0;

        let filteredNewItems;
        let filteredAllOrders;

        if (hasCategoryFilter) {
          // Filter newItems by cook's categories
          filteredNewItems = newItems.filter(item => {
            const itemCategoryId = item.categoryId?.toString() || item.foodId?.categoryId?.toString();
            if (!itemCategoryId) return false;
            return cookCategories.some(catId => catId.toString() === itemCategoryId);
          });

          // Filter allOrders
          filteredAllOrders = allKitchenOrders.map(o => {
            const filteredItems = o.items.filter(item => {
              const itemCategoryId = item.foodId?.categoryId?.toString() || item.categoryId?.toString();
              if (!itemCategoryId) return false;
              return cookCategories.some(catId => catId.toString() === itemCategoryId);
            });
            return { ...o, items: filteredItems };
          }).filter(o => o.items.length > 0);
        } else {
          // No category filter - all items
          filteredNewItems = newItems;
          filteredAllOrders = allKitchenOrders;
        }

        // Only emit if there are relevant items for this cook
        if (filteredNewItems.length > 0) {
          this.emitToUser(cook._id.toString(), 'new_kitchen_order', {
            order: order,
            allOrders: filteredAllOrders,
            isNewOrder: false,
            newItems: filteredNewItems
          });
        }
      }
    } catch (err) {
      console.error('Error emitting filtered new_kitchen_order for added items:', err);
      // Fallback
      this.emitToRole(restaurantId, 'cook', 'new_kitchen_order', {
        order: order,
        allOrders: allKitchenOrders,
        isNewOrder: false,
        newItems: newItems
      });
    }
  }
}

// Singleton instance
const socketService = new SocketService();

module.exports = socketService;
