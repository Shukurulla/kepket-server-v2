const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

const tableSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID is required'],
    index: true
  },

  // Stol kategoriyasi (Divan, Stol, Kabina, etc.)
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TableCategory',
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
    enum: ['indoor', 'outdoor', 'vip', 'bar', 'banquet'],
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
  },

  // === TZ 1.2 va 6.1-6.2: Banket zali boshqaruvi ===
  isBanquetHall: {
    type: Boolean,
    default: false
  },
  // Virtual stol (banket zalidan ajratilgan)
  isVirtualTable: {
    type: Boolean,
    default: false
  },
  // Qaysi banket zalidan ajratilgan
  parentHallId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  },
  // Banket zal hozir bo'linganmi
  isSplit: {
    type: Boolean,
    default: false
  },
  // Nechta stolga bo'lingan
  splitTableCount: {
    type: Number,
    default: 0,
    min: 0
  },
  // Banket zal soatlik narxi (default 10,000 so'm)
  banquetHourlyRate: {
    type: Number,
    default: 10000,
    min: 0
  },
  // Banket rejimi: 'normal' (soatlik to'lov) yoki 'split' (stollar, 10% xizmat haqi)
  banquetMode: {
    type: String,
    enum: ['normal', 'split'],
    default: 'normal'
  },
  // Bo'lingan stollar uchun xizmat haqi foizi
  banquetServiceChargePercent: {
    type: Number,
    default: 10,
    min: 0,
    max: 100
  },
  // Banket boshlanish vaqti (soatlik hisoblash uchun)
  banquetStartTime: Date,
  // Virtual stollar ID ro'yxati
  virtualTableIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  }]
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

// Virtual: Category info
tableSchema.virtual('category', {
  ref: 'TableCategory',
  localField: 'categoryId',
  foreignField: '_id',
  justOne: true
});

// Static: Find tables by restaurant
tableSchema.statics.findByRestaurant = function(restaurantId) {
  return this.find({ restaurantId })
    .populate('assignedWaiterId', 'firstName lastName')
    .populate('categoryId', 'title icon')
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

// TZ 1.2: Banket zalini stolga bo'lish
tableSchema.methods.splitIntoTables = async function(tableCount) {
  if (!this.isBanquetHall) {
    throw new Error('Bu stol banket zali emas');
  }
  if (this.isSplit) {
    throw new Error('Bu zal allaqachon bo\'lingan');
  }

  const Table = mongoose.model('Table');
  const createdTables = [];

  for (let i = 1; i <= tableCount; i++) {
    const virtualTable = await Table.create({
      restaurantId: this.restaurantId,
      title: `${this.title} - Stol ${i}`,
      status: 'free',
      capacity: Math.floor(this.capacity / tableCount) || 2,
      location: 'banquet',
      isVirtualTable: true,
      parentHallId: this._id,
      // Bo'lingan stollar uchun 10% xizmat haqi
      hasHourlyCharge: false,
      hourlyChargeAmount: 0,
      banquetServiceChargePercent: 10
    });
    createdTables.push(virtualTable);
  }

  this.isSplit = true;
  this.splitTableCount = tableCount;
  this.banquetMode = 'split';
  this.virtualTableIds = createdTables.map(t => t._id);
  await this.save();

  return createdTables;
};

// TZ 1.2: Banket zalini qayta birlashtirish
tableSchema.methods.mergeTables = async function() {
  if (!this.isBanquetHall) {
    throw new Error('Bu stol banket zali emas');
  }
  if (!this.isSplit) {
    throw new Error('Bu zal bo\'linmagan');
  }

  const Table = mongoose.model('Table');

  // Faol buyurtmalar bor-yo'qligini tekshirish
  const Order = mongoose.model('Order');
  const activeOrders = await Order.countDocuments({
    tableId: { $in: this.virtualTableIds },
    isPaid: false,
    status: { $nin: ['paid', 'cancelled'] }
  });

  if (activeOrders > 0) {
    throw new Error('Virtual stollarda faol buyurtmalar mavjud. Avval ularni yoping.');
  }

  // Virtual stollarni o'chirish
  await Table.deleteMany({ _id: { $in: this.virtualTableIds } });

  this.isSplit = false;
  this.splitTableCount = 0;
  this.banquetMode = 'normal';
  this.virtualTableIds = [];
  await this.save();

  return this;
};

// Static: Banket zallarini topish
tableSchema.statics.findBanquetHalls = function(restaurantId) {
  return this.find({ restaurantId, isBanquetHall: true })
    .populate('virtualTableIds')
    .sort({ title: 1 });
};

const Table = mongoose.model('Table', tableSchema);

module.exports = Table;
