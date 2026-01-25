const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const softDeletePlugin = require('./plugins/softDelete');

const staffSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID is required'],
    index: true
  },

  // Personal info
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true
  },
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true
  },
  phone: {
    type: String,
    required: [true, 'Phone number is required'],
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 4,
    select: false // Don't include in queries by default
  },
  avatar: String,

  // Role
  role: {
    type: String,
    enum: {
      values: ['admin', 'waiter', 'cook', 'cashier'],
      message: 'Invalid role: {VALUE}'
    },
    required: [true, 'Role is required'],
    index: true
  },

  // Status
  status: {
    type: String,
    enum: ['working', 'fired'],
    default: 'working'
  },
  isWorking: {
    type: Boolean,
    default: false  // Currently on shift
  },
  isOnline: {
    type: Boolean,
    default: false  // Socket connected
  },

  // Cook specific
  assignedCategories: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  }],
  autoReady: {
    type: Boolean,
    default: false // Auto mark items as ready
  },

  // Waiter specific
  assignedTables: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  }],
  salaryPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  doubleConfirmation: {
    type: Boolean,
    default: false // Require double confirmation for orders
  },

  // Connection
  socketId: String,
  fcmToken: String,
  lastSeenAt: Date,

  // Stats cache (updated periodically)
  stats: {
    totalOrders: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    todayOrders: { type: Number, default: 0 },
    todayRevenue: { type: Number, default: 0 }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
staffSchema.plugin(softDeletePlugin);

// Virtual: Full name
staffSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual: Display name
staffSchema.virtual('name').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Index for faster queries
staffSchema.index({ restaurantId: 1, role: 1 });
staffSchema.index({ restaurantId: 1, status: 1 });

// Hash password before saving
staffSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Compare password method
staffSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Transform output (remove password)
staffSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

// Static: Find by phone with password
staffSchema.statics.findByPhoneWithPassword = function(phone) {
  return this.findOne({ phone }).select('+password');
};

// Static: Find by role in restaurant
staffSchema.statics.findByRole = function(restaurantId, role) {
  return this.find({ restaurantId, role, status: 'working' });
};

const Staff = mongoose.model('Staff', staffSchema);

module.exports = Staff;
