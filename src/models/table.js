const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const tableSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID is required'],
    index: true
  },

  title: {
    type: String,
    required: [true, 'Table title is required'],
    trim: true
  },

  status: {
    type: String,
    enum: ['free', 'occupied', 'reserved'],
    default: 'free',
    index: true
  },

  // Assigned waiter
  assignedWaiterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },

  // Capacity
  capacity: {
    type: Number,
    default: 4,
    min: 1
  },

  // Location in restaurant
  location: {
    type: String,
    enum: ['indoor', 'outdoor', 'vip', 'bar'],
    default: 'indoor'
  },

  // Surcharge settings
  surcharge: {
    type: Number,
    default: 0,
    min: 0
  },
  hasHourlyCharge: {
    type: Boolean,
    default: false
  },
  hourlyChargeAmount: {
    type: Number,
    default: 0,
    min: 0
  },

  // QR code for customer ordering
  qrCode: String,

  // Active order reference (for quick lookup)
  activeOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
tableSchema.plugin(softDeletePlugin);

// Compound index for unique table title per restaurant
tableSchema.index({ restaurantId: 1, title: 1 }, { unique: true });

// Virtual: Waiter info
tableSchema.virtual('waiter', {
  ref: 'Staff',
  localField: 'assignedWaiterId',
  foreignField: '_id',
  justOne: true
});

// Virtual: Active order
tableSchema.virtual('activeOrder', {
  ref: 'Order',
  localField: 'activeOrderId',
  foreignField: '_id',
  justOne: true
});

// Static: Find tables by restaurant
tableSchema.statics.findByRestaurant = function(restaurantId) {
  return this.find({ restaurantId })
    .populate('assignedWaiterId', 'firstName lastName')
    .sort({ title: 1 });
};

// Static: Find free tables
tableSchema.statics.findFreeTables = function(restaurantId) {
  return this.find({ restaurantId, status: 'free' }).sort({ title: 1 });
};

// Static: Find tables by waiter
tableSchema.statics.findByWaiter = function(waiterId) {
  return this.find({ assignedWaiterId: waiterId }).sort({ title: 1 });
};

// Methods
tableSchema.methods.occupy = function(orderId = null) {
  this.status = 'occupied';
  if (orderId) this.activeOrderId = orderId;
  return this.save();
};

tableSchema.methods.free = function() {
  this.status = 'free';
  this.activeOrderId = null;
  return this.save();
};

tableSchema.methods.reserve = function() {
  this.status = 'reserved';
  return this.save();
};

tableSchema.methods.assignWaiter = function(waiterId) {
  this.assignedWaiterId = waiterId;
  return this.save();
};

const Table = mongoose.model('Table', tableSchema);

module.exports = Table;
