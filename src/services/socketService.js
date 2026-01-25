const { Server } = require('socket.io');
const { verifyToken } = require('../middleware/auth');
const { Staff } = require('../models');
const config = require('../config/env');

class SocketService {
  constructor() {
    this.io = null;
    this.connectedUsers = new Map(); // staffId -> socketId
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

    // Bell/call waiter
    socket.on('call_waiter', async (data) => {
      await this.handleCallWaiter(socket, data);
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

    await Staff.findByIdAndUpdate(cookId, {
      isOnline: true,
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
      const { Order, Table } = require('../models');

      const orderNumber = await Order.getNextOrderNumber(data.restaurantId);

      const order = new Order({
        restaurantId: data.restaurantId,
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
          status: { $in: ['pending', 'preparing', 'approved', 'ready'] },
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

        // new_kitchen_order event - cook-web kutgan format
        this.emitToRole(data.restaurantId, 'cook', 'new_kitchen_order', {
          order: order,
          allOrders: kitchenOrders,
          isNewOrder: true,
          newItems: order.items.map(i => ({ ...i.toObject(), kitchenStatus: i.status }))
        });

        // kitchen_orders_updated ham yuborish (backward compatibility)
        this.emitToRole(data.restaurantId, 'cook', 'kitchen_orders_updated', kitchenOrders);
      } catch (err) {
        console.error('Error fetching kitchen orders for cook:', err);
      }

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
        const rawKitchenOrders = await Order.find({
          restaurantId,
          status: { $in: ['pending', 'approved', 'preparing', 'ready', 'served'] },
          'items.status': { $in: ['pending', 'preparing', 'ready', 'served'] }
        }).populate('items.foodId', 'name price categoryId image')
          .populate('tableId', 'title tableNumber number')
          .populate('waiterId', 'firstName lastName')
          .sort({ createdAt: -1 });

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

        this.emitToRole(restaurantId.toString(), 'cook', 'kitchen_orders_updated', kitchenOrders);
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
}

// Singleton instance
const socketService = new SocketService();

module.exports = socketService;
