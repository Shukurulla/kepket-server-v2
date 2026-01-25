const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const restaurantSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Restaurant name is required'],
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    sparse: true,
    lowercase: true
  },
  address: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  logo: String,

  subscription: {
    status: {
      type: String,
      enum: ['active', 'blocked', 'expired'],
      default: 'active'
    },
    expiresAt: Date,
    plan: {
      type: String,
      enum: ['basic', 'pro', 'enterprise'],
      default: 'basic'
    }
  },

  settings: {
    serviceChargePercent: { type: Number, default: 10, min: 0, max: 100 },
    currency: { type: String, default: 'UZS' },
    timezone: { type: String, default: 'Asia/Tashkent' },
    autoApproveOrders: { type: Boolean, default: false },
    requireWaiterApproval: { type: Boolean, default: true }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
restaurantSchema.plugin(softDeletePlugin);

// Generate slug from name
restaurantSchema.pre('save', function(next) {
  if (this.isModified('name') && !this.slug) {
    this.slug = this.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
  next();
});

// Virtual: Check if subscription is active
restaurantSchema.virtual('isActive').get(function() {
  if (this.subscription.status !== 'active') return false;
  if (this.subscription.expiresAt && new Date() > this.subscription.expiresAt) return false;
  return true;
});

const Restaurant = mongoose.model('Restaurant', restaurantSchema);

module.exports = Restaurant;
