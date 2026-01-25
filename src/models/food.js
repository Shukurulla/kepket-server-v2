const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const foodSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID is required'],
    index: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: [true, 'Category ID is required'],
    index: true
  },

  foodName: {
    type: String,
    required: [true, 'Food name is required'],
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'Price is required'],
    min: [0, 'Price cannot be negative']
  },
  description: {
    type: String,
    trim: true
  },
  image: String,

  isAvailable: {
    type: Boolean,
    default: true
  },
  // Ikki marta tasdiqlash kerakmi (oshpaz uchun)
  requireDoubleConfirmation: {
    type: Boolean,
    default: false
  },
  preparationTime: {
    type: Number, // minutes
    min: 0
  },

  // === TZ 1.3, 2.2, 2.3, 3.7: Stop-list boshqaruvi ===
  isInStopList: {
    type: Boolean,
    default: false,
    index: true
  },
  stopListReason: {
    type: String,
    trim: true
  },
  stoppedAt: Date,
  stoppedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  stoppedByName: String,
  resumedAt: Date,
  resumedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  resumedByName: String,

  // Nutrition info (optional)
  nutrition: {
    calories: Number,
    protein: Number,
    carbs: Number,
    fat: Number
  },

  // Tags for filtering
  tags: [String],

  // Popularity tracking
  orderCount: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
foodSchema.plugin(softDeletePlugin);

// Compound indexes
foodSchema.index({ restaurantId: 1, categoryId: 1 });
foodSchema.index({ restaurantId: 1, isAvailable: 1 });
foodSchema.index({ restaurantId: 1, orderCount: -1 }); // For popular items

// Virtual: name alias for foodName
foodSchema.virtual('name').get(function() {
  return this.foodName;
});

// Static: Find available foods by category
foodSchema.statics.findAvailableByCategory = function(restaurantId, categoryId) {
  return this.find({
    restaurantId,
    categoryId,
    isAvailable: true
  }).sort({ foodName: 1 });
};

// Static: Find available foods by restaurant
foodSchema.statics.findAvailableByRestaurant = function(restaurantId) {
  return this.find({
    restaurantId,
    isAvailable: true
  }).populate('categoryId', 'title').sort({ foodName: 1 });
};

// Static: Get popular foods
foodSchema.statics.getPopular = function(restaurantId, limit = 10) {
  return this.find({
    restaurantId,
    isAvailable: true
  }).sort({ orderCount: -1 }).limit(limit);
};

// Increment order count
foodSchema.methods.incrementOrderCount = function(count = 1) {
  this.orderCount += count;
  return this.save();
};

// TZ 1.3: Stop-list metodlari
foodSchema.methods.addToStopList = function(reason, staffId, staffName) {
  this.isInStopList = true;
  this.stopListReason = reason;
  this.stoppedAt = new Date();
  this.stoppedBy = staffId;
  this.stoppedByName = staffName;
  this.resumedAt = null;
  this.resumedBy = null;
  this.resumedByName = null;
  return this.save();
};

foodSchema.methods.removeFromStopList = function(staffId, staffName) {
  this.isInStopList = false;
  this.resumedAt = new Date();
  this.resumedBy = staffId;
  this.resumedByName = staffName;
  return this.save();
};

// Static: Get stop-list items
foodSchema.statics.getStopList = function(restaurantId) {
  return this.find({
    restaurantId,
    isInStopList: true
  }).populate('categoryId', 'title').sort({ stoppedAt: -1 });
};

const Food = mongoose.model('Food', foodSchema);

module.exports = Food;
