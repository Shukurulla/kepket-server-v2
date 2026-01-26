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
  },

  // === Avto stop-list (kunlik limit asosida) ===
  autoStopListEnabled: {
    type: Boolean,
    default: false
  },
  dailyOrderLimit: {
    type: Number,
    default: 0, // 0 = cheksiz
    min: 0
  },
  dailyOrderCount: {
    type: Number,
    default: 0
  },
  lastOrderCountReset: {
    type: Date,
    default: Date.now
  },
  autoStoppedAt: Date, // Avto stop-list ga tushgan vaqti
  autoStopReason: String // Avto stop sababi
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

// === Avto stop-list metodlari ===

/**
 * Kunlik order countni increment qilish va limitni tekshirish
 * @param {number} quantity - buyurtma miqdori
 * @returns {object} { autoStopped: boolean, newCount: number }
 */
foodSchema.methods.incrementDailyOrderCount = async function(quantity = 1) {
  // Avval kunlik countni reset qilish kerakmi tekshirish
  await this.checkAndResetDailyCount();

  this.dailyOrderCount += quantity;
  this.orderCount += quantity; // Umumiy count ham

  let autoStopped = false;

  // Avto stop-list yoqilgan va limit belgilangan bo'lsa
  if (this.autoStopListEnabled && this.dailyOrderLimit > 0) {
    if (this.dailyOrderCount >= this.dailyOrderLimit && !this.isInStopList) {
      // Limitga yetdi - avto stop-listga qo'shish
      this.isInStopList = true;
      this.autoStoppedAt = new Date();
      this.autoStopReason = `Kunlik limit (${this.dailyOrderLimit} ta) tugadi`;
      this.stopListReason = this.autoStopReason;
      this.stoppedAt = new Date();
      this.stoppedByName = 'Avtomatik';
      autoStopped = true;
    }
  }

  await this.save();

  return {
    autoStopped,
    newCount: this.dailyOrderCount,
    limit: this.dailyOrderLimit,
    remaining: Math.max(0, this.dailyOrderLimit - this.dailyOrderCount)
  };
};

/**
 * Kunlik countni reset qilish kerakmi tekshirish (yangi kun bo'lsa)
 * @param {boolean} saveIfChanged - o'zgarsa saqlasinmi (default: false)
 * @returns {boolean} - o'zgargan bo'lsa true
 */
foodSchema.methods.checkAndResetDailyCount = async function(saveIfChanged = false) {
  const now = new Date();
  const lastReset = this.lastOrderCountReset || new Date(0);
  let changed = false;

  // Oxirgi reset boshqa kunda bo'lgan bo'lsa
  if (lastReset.toDateString() !== now.toDateString()) {
    this.dailyOrderCount = 0;
    this.lastOrderCountReset = now;
    changed = true;

    // Agar avto stop-list sababli to'xtatilgan bo'lsa - qayta yoqish
    if (this.isInStopList && this.autoStoppedAt) {
      this.isInStopList = false;
      this.autoStoppedAt = null;
      this.autoStopReason = null;
      this.resumedAt = now;
      this.resumedByName = 'Avtomatik (yangi kun)';
    }

    // Agar save kerak bo'lsa
    if (saveIfChanged) {
      await this.save();
    }
  }

  return changed;
};

/**
 * Static: Barcha ovqatlarning kunlik countini reset qilish
 */
foodSchema.statics.resetAllDailyOrderCounts = async function(restaurantId) {
  const now = new Date();

  // Avto stop-listdan chiqarish
  await this.updateMany(
    {
      restaurantId,
      isInStopList: true,
      autoStoppedAt: { $exists: true, $ne: null }
    },
    {
      $set: {
        isInStopList: false,
        autoStoppedAt: null,
        autoStopReason: null,
        resumedAt: now,
        resumedByName: 'Avtomatik (kunlik reset)'
      }
    }
  );

  // Barcha daily countlarni 0 ga tushirish
  await this.updateMany(
    { restaurantId },
    {
      $set: {
        dailyOrderCount: 0,
        lastOrderCountReset: now
      }
    }
  );

  return { success: true, resetAt: now };
};

/**
 * Static: Limitga yaqinlashgan ovqatlarni olish
 */
foodSchema.statics.getFoodsNearLimit = function(restaurantId, threshold = 0.8) {
  return this.find({
    restaurantId,
    autoStopListEnabled: true,
    dailyOrderLimit: { $gt: 0 },
    $expr: {
      $gte: [
        { $divide: ['$dailyOrderCount', '$dailyOrderLimit'] },
        threshold
      ]
    }
  }).populate('categoryId', 'title');
};

const Food = mongoose.model('Food', foodSchema);

module.exports = Food;
