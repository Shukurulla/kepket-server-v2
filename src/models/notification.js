const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const notificationItemSchema = new mongoose.Schema({
  foodName: String,
  quantity: Number
}, { _id: false });

const notificationSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true,
    index: true
  },
  staffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    required: true,
    index: true
  },

  type: {
    type: String,
    enum: [
      'order_ready',      // Order items are ready
      'new_table',        // New table assigned
      'waiter_called',    // Customer pressed bell
      'new_order',        // New order created
      'order_paid',       // Order payment processed
      'order_cancelled',  // Order cancelled
      'item_ready'        // Specific item ready
    ],
    required: true,
    index: true
  },

  title: {
    type: String,
    required: true
  },
  message: String,

  // Related entities
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  tableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  },

  // For order_ready notifications
  items: [notificationItemSchema],

  // Status
  isRead: {
    type: Boolean,
    default: false
  },
  readAt: Date,

  isCompleted: {
    type: Boolean,
    default: false
  },
  completedAt: Date,

  // Priority
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },

  // Expiry (auto-dismiss after time)
  expiresAt: Date
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
notificationSchema.plugin(softDeletePlugin);

// Indexes
notificationSchema.index({ staffId: 1, isRead: 1, createdAt: -1 });
notificationSchema.index({ staffId: 1, isCompleted: 1 });
notificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 * 7 }); // Auto-delete after 7 days

// Virtual: Related order
notificationSchema.virtual('order', {
  ref: 'Order',
  localField: 'orderId',
  foreignField: '_id',
  justOne: true
});

// Virtual: Related table
notificationSchema.virtual('table', {
  ref: 'Table',
  localField: 'tableId',
  foreignField: '_id',
  justOne: true
});

// Methods
notificationSchema.methods.markRead = function() {
  this.isRead = true;
  this.readAt = new Date();
  return this.save();
};

notificationSchema.methods.markCompleted = function() {
  this.isCompleted = true;
  this.completedAt = new Date();
  return this.save();
};

// Static: Create notification
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this(data);
  await notification.save();
  return notification;
};

// Static: Get unread by staff
notificationSchema.statics.getUnreadByStaff = function(staffId) {
  return this.find({
    staffId,
    isRead: false
  }).sort({ createdAt: -1 });
};

// Static: Get by staff with pagination
notificationSchema.statics.getByStaff = function(staffId, page = 1, limit = 20) {
  return this.find({ staffId })
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);
};

// Static: Mark all as read for staff
notificationSchema.statics.markAllReadByStaff = function(staffId) {
  return this.updateMany(
    { staffId, isRead: false },
    { $set: { isRead: true, readAt: new Date() } }
  );
};

// Static: Count unread
notificationSchema.statics.countUnreadByStaff = function(staffId) {
  return this.countDocuments({ staffId, isRead: false });
};

// Static: Create order ready notification
notificationSchema.statics.createOrderReadyNotification = async function(order, items = []) {
  if (!order.waiterId) return null;

  const itemsList = items.length > 0 ? items : order.activeItems.map(item => ({
    foodName: item.foodName,
    quantity: item.quantity
  }));

  return this.createNotification({
    restaurantId: order.restaurantId,
    staffId: order.waiterId,
    type: 'order_ready',
    title: `${order.tableName} - Buyurtma tayyor`,
    message: `${itemsList.length} ta taom tayyor`,
    orderId: order._id,
    tableId: order.tableId,
    items: itemsList,
    priority: 'high'
  });
};

// Static: Create waiter called notification
notificationSchema.statics.createWaiterCalledNotification = async function(table) {
  if (!table.assignedWaiterId) return null;

  return this.createNotification({
    restaurantId: table.restaurantId,
    staffId: table.assignedWaiterId,
    type: 'waiter_called',
    title: `${table.title} - Ofitsiant chaqirildi`,
    message: 'Mijoz sizni chaqirmoqda',
    tableId: table._id,
    priority: 'urgent'
  });
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
