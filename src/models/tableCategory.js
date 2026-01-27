const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const tableCategorySchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID is required'],
    index: true
  },

  title: {
    type: String,
    required: [true, 'Category title is required'],
    trim: true
  },

  description: String,

  icon: {
    type: String,
    default: 'table' // table, sofa, door, etc.
  },

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
tableCategorySchema.plugin(softDeletePlugin);

// Compound index
tableCategorySchema.index({ restaurantId: 1, sortOrder: 1 });

// Virtual: Table count
tableCategorySchema.virtual('tableCount', {
  ref: 'Table',
  localField: '_id',
  foreignField: 'categoryId',
  count: true
});

// Virtual: Tables in this category
tableCategorySchema.virtual('tables', {
  ref: 'Table',
  localField: '_id',
  foreignField: 'categoryId'
});

// Static: Find active categories by restaurant
tableCategorySchema.statics.findActiveByRestaurant = function(restaurantId) {
  return this.find({ restaurantId, isActive: true, isDeleted: { $ne: true } }).sort({ sortOrder: 1 });
};

// Static: Find by restaurant with table count
tableCategorySchema.statics.findWithTableCount = async function(restaurantId) {
  return this.aggregate([
    { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId), isDeleted: { $ne: true } } },
    {
      $lookup: {
        from: 'tables',
        localField: '_id',
        foreignField: 'categoryId',
        as: 'tables'
      }
    },
    {
      $addFields: {
        tableCount: { $size: '$tables' }
      }
    },
    { $project: { tables: 0 } },
    { $sort: { sortOrder: 1 } }
  ]);
};

const TableCategory = mongoose.model('TableCategory', tableCategorySchema);

module.exports = TableCategory;
