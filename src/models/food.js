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

const Food = mongoose.model('Food', foodSchema);

module.exports = Food;
