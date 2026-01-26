const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const categorySchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID is required'],
    index: true
  },

  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    default: null,
    index: true
  },

  title: {
    type: String,
    required: [true, 'Category title is required'],
    trim: true
  },
  slug: {
    type: String,
    lowercase: true
  },
  image: String,
  description: String,

  sortOrder: {
    type: Number,
    default: 0
  },

  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
categorySchema.plugin(softDeletePlugin);

// Compound index
categorySchema.index({ restaurantId: 1, sortOrder: 1 });

// Generate slug from title
categorySchema.pre('save', function(next) {
  if (this.isModified('title') && !this.slug) {
    this.slug = this.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

// Virtual: Food count (populated separately)
categorySchema.virtual('foodCount', {
  ref: 'Food',
  localField: '_id',
  foreignField: 'categoryId',
  count: true
});

// Virtual: Children categories
categorySchema.virtual('children', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentId'
});

// Static: Find active categories by restaurant
categorySchema.statics.findActiveByRestaurant = function(restaurantId) {
  return this.find({ restaurantId, isActive: true }).sort({ sortOrder: 1 });
};

const Category = mongoose.model('Category', categorySchema);

module.exports = Category;
