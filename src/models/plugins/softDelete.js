const mongoose = require('mongoose');

/**
 * Soft Delete Plugin
 * Adds isDeleted, deletedAt, deletedBy fields and auto-filters deleted documents
 */
const softDeletePlugin = (schema) => {
  // Add soft delete fields
  schema.add({
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff', default: null }
  });

  // Auto-filter deleted documents in find queries
  schema.pre(/^find/, function(next) {
    // Skip filter if includeDeleted option is set
    if (this.getOptions().includeDeleted === true) {
      return next();
    }

    // Add isDeleted: false to query
    this.where({ isDeleted: { $ne: true } });
    next();
  });

  // Auto-filter in aggregate
  schema.pre('aggregate', function(next) {
    if (this.options && this.options.includeDeleted === true) {
      return next();
    }

    // Add match stage at the beginning
    this.pipeline().unshift({ $match: { isDeleted: { $ne: true } } });
    next();
  });

  // Soft delete method
  schema.methods.softDelete = async function(deletedById = null) {
    this.isDeleted = true;
    this.deletedAt = new Date();
    if (deletedById) {
      this.deletedBy = deletedById;
    }
    return this.save();
  };

  // Restore method
  schema.methods.restore = async function() {
    this.isDeleted = false;
    this.deletedAt = null;
    this.deletedBy = null;
    return this.save();
  };

  // Static soft delete by ID
  schema.statics.softDeleteById = async function(id, deletedById = null) {
    const doc = await this.findById(id);
    if (!doc) return null;
    return doc.softDelete(deletedById);
  };

  // Static restore by ID
  schema.statics.restoreById = async function(id) {
    const doc = await this.findById(id).setOptions({ includeDeleted: true });
    if (!doc) return null;
    return doc.restore();
  };

  // Find deleted documents
  schema.statics.findDeleted = function(filter = {}) {
    return this.find({ ...filter, isDeleted: true }).setOptions({ includeDeleted: true });
  };

  // Find all including deleted
  schema.statics.findWithDeleted = function(filter = {}) {
    return this.find(filter).setOptions({ includeDeleted: true });
  };

  // Count deleted documents
  schema.statics.countDeleted = function(filter = {}) {
    return this.countDocuments({ ...filter, isDeleted: true }).setOptions({ includeDeleted: true });
  };
};

module.exports = softDeletePlugin;
