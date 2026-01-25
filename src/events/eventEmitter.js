const socketService = require('../services/socketService');

/**
 * Order Event Types
 */
const ORDER_EVENTS = {
  CREATED: 'order:created',
  UPDATED: 'order:updated',
  DELETED: 'order:deleted',
  APPROVED: 'order:approved',
  REJECTED: 'order:rejected',
  PAID: 'order:paid',
  ITEM_READY: 'item:ready',
  ALL_ITEMS_READY: 'item:all_ready'
};

/**
 * Staff Event Types
 */
const STAFF_EVENTS = {
  ONLINE: 'staff:online',
  OFFLINE: 'staff:offline'
};

/**
 * Table Event Types
 */
const TABLE_EVENTS = {
  ASSIGNED: 'table:assigned',
  STATUS_CHANGED: 'table:status_changed',
  WAITER_CALLED: 'waiter:called'
};

/**
 * Emit order event to all relevant clients
 */
const emitOrderEvent = (restaurantId, eventType, data) => {
  socketService.emitToRestaurant(restaurantId, eventType, data);

  // Also emit legacy events for backward compatibility
  switch (eventType) {
    case ORDER_EVENTS.CREATED:
      socketService.emitToRole(restaurantId, 'cook', 'kitchen_orders_updated', data);
      socketService.emitToRole(restaurantId, 'cashier', 'new_order', data);
      break;

    case ORDER_EVENTS.UPDATED:
      socketService.emitToRole(restaurantId, 'cook', 'kitchen_orders_updated', data);
      if (data.action === 'item_deleted' || data.action === 'item_quantity_changed') {
        socketService.emitToRole(restaurantId, 'cashier', 'order_item_deleted', data);
      }
      break;

    case ORDER_EVENTS.DELETED:
      socketService.emitToRole(restaurantId, 'cook', 'kitchen_orders_updated', data);
      socketService.emitToRole(restaurantId, 'cashier', 'order_deleted', data);
      break;

    case ORDER_EVENTS.PAID:
      socketService.emitToRole(restaurantId, 'waiter', 'order_paid', data);
      break;

    case ORDER_EVENTS.ITEM_READY:
    case ORDER_EVENTS.ALL_ITEMS_READY:
      // Notify specific waiter
      if (data.order && data.order.waiterId) {
        socketService.emitToUser(data.order.waiterId.toString(), 'order_ready_notification', data);
      }
      break;
  }
};

/**
 * Emit table event
 */
const emitTableEvent = (restaurantId, eventType, data) => {
  socketService.emitToRestaurant(restaurantId, eventType, data);

  // Role-specific emissions
  if (eventType === TABLE_EVENTS.ASSIGNED && data.waiterId) {
    socketService.emitToUser(data.waiterId, 'new_table_assigned', data);
  }

  if (eventType === TABLE_EVENTS.WAITER_CALLED && data.waiterId) {
    socketService.emitToUser(data.waiterId, 'waiter_called', data);
  }
};

/**
 * Emit staff event
 */
const emitStaffEvent = (restaurantId, eventType, data) => {
  socketService.emitToRestaurant(restaurantId, eventType, data);
};

/**
 * Emit to specific user
 */
const emitToUser = (userId, event, data) => {
  socketService.emitToUser(userId, event, data);
};

/**
 * Emit to role
 */
const emitToRole = (restaurantId, role, event, data) => {
  socketService.emitToRole(restaurantId, role, event, data);
};

module.exports = {
  ORDER_EVENTS,
  STAFF_EVENTS,
  TABLE_EVENTS,
  emitOrderEvent,
  emitTableEvent,
  emitStaffEvent,
  emitToUser,
  emitToRole
};
