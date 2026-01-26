const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

/**
 * Smena (Shift) Model
 * Restoran ish smenasini boshqarish uchun
 */
const shiftSchema = new mongoose.Schema({
  // Restoran ID
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID kiritilishi shart'],
    index: true
  },

  // Smena raqami (auto-increment per restaurant)
  shiftNumber: {
    type: Number,
    required: true
  },

  // Smena holati
  status: {
    type: String,
    enum: ['active', 'closed'],
    default: 'active',
    index: true
  },

  // Vaqt
  openedAt: {
    type: Date,
    default: Date.now,
    required: true
  },
  closedAt: {
    type: Date,
    default: null
  },

  // Xodimlar
  openedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    required: [true, 'Smenani ochgan xodim kiritilishi shart']
  },
  closedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    default: null
  },

  // Kassa
  openingCash: {
    type: Number,
    default: 0,
    min: [0, 'Boshlang\'ich kassa 0 dan kam bo\'lishi mumkin emas']
  },
  closingCash: {
    type: Number,
    default: null
  },
  expectedClosingCash: {
    type: Number,
    default: null
  },
  cashDifference: {
    type: Number,
    default: null
  },

  // Smena statistikasi (yopilganda hisoblanadi)
  stats: {
    // Buyurtmalar
    totalOrders: { type: Number, default: 0 },
    paidOrders: { type: Number, default: 0 },
    cancelledOrders: { type: Number, default: 0 },

    // Daromad
    totalRevenue: { type: Number, default: 0 },
    foodRevenue: { type: Number, default: 0 },
    serviceRevenue: { type: Number, default: 0 },

    // To'lov turlari
    cashPayments: { type: Number, default: 0 },
    cardPayments: { type: Number, default: 0 },
    clickPayments: { type: Number, default: 0 },
    mixedPayments: { type: Number, default: 0 },

    // Qo'shimcha
    averageOrderValue: { type: Number, default: 0 },
    totalItemsSold: { type: Number, default: 0 },
    totalCancelledItems: { type: Number, default: 0 },
    cancelledItemsValue: { type: Number, default: 0 }
  },

  // Izohlar
  openingNotes: {
    type: String,
    default: ''
  },
  closingNotes: {
    type: String,
    default: ''
  },

  // O'tkazilgan to'lanmagan buyurtmalar (yangi smenaga)
  transferredOrderIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  }]
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
shiftSchema.plugin(softDeletePlugin);

// Indexes
shiftSchema.index({ restaurantId: 1, status: 1 });
shiftSchema.index({ restaurantId: 1, openedAt: -1 });
shiftSchema.index({ restaurantId: 1, shiftNumber: -1 });

/**
 * Static: Keyingi smena raqamini olish
 */
shiftSchema.statics.getNextShiftNumber = async function(restaurantId) {
  const lastShift = await this.findOne({ restaurantId })
    .sort({ shiftNumber: -1 })
    .select('shiftNumber')
    .setOptions({ includeDeleted: true });
  return (lastShift?.shiftNumber || 0) + 1;
};

/**
 * Static: Aktiv smenani olish
 */
shiftSchema.statics.getActiveShift = async function(restaurantId) {
  return this.findOne({
    restaurantId,
    status: 'active'
  });
};

/**
 * Static: Aktiv smena borligini tekshirish
 */
shiftSchema.statics.hasActiveShift = async function(restaurantId) {
  const count = await this.countDocuments({
    restaurantId,
    status: 'active'
  });
  return count > 0;
};

/**
 * Method: Smena statistikasini hisoblash
 */
shiftSchema.methods.calculateStats = async function() {
  const Order = mongoose.model('Order');

  const orders = await Order.find({
    shiftId: this._id
  }).setOptions({ includeDeleted: false });

  const stats = {
    totalOrders: orders.length,
    paidOrders: 0,
    cancelledOrders: 0,
    totalRevenue: 0,
    foodRevenue: 0,
    serviceRevenue: 0,
    cashPayments: 0,
    cardPayments: 0,
    clickPayments: 0,
    mixedPayments: 0,
    totalItemsSold: 0,
    totalCancelledItems: 0,
    cancelledItemsValue: 0
  };

  for (const order of orders) {
    // To'langan buyurtmalar
    if (order.isPaid) {
      stats.paidOrders++;
      stats.totalRevenue += order.grandTotal || 0;
      stats.foodRevenue += order.subtotal || 0;
      stats.serviceRevenue += order.serviceCharge || 0;

      // To'lov turi
      switch (order.paymentType) {
        case 'cash':
          stats.cashPayments += order.grandTotal || 0;
          break;
        case 'card':
          stats.cardPayments += order.grandTotal || 0;
          break;
        case 'click':
          stats.clickPayments += order.grandTotal || 0;
          break;
        case 'mixed':
          stats.mixedPayments += order.grandTotal || 0;
          // Split bo'lsa
          if (order.paymentSplit) {
            stats.cashPayments += order.paymentSplit.cash || 0;
            stats.cardPayments += order.paymentSplit.card || 0;
            stats.clickPayments += order.paymentSplit.click || 0;
          }
          break;
      }
    }

    // Bekor qilingan buyurtmalar
    if (order.status === 'cancelled') {
      stats.cancelledOrders++;
    }

    // Itemlarni hisoblash
    for (const item of order.items) {
      if (!item.isDeleted && item.status !== 'cancelled') {
        stats.totalItemsSold += item.quantity;
      } else if (item.status === 'cancelled') {
        stats.totalCancelledItems += item.quantity;
        stats.cancelledItemsValue += (item.price * item.quantity);
      }
    }
  }

  // O'rtacha buyurtma qiymati
  stats.averageOrderValue = stats.paidOrders > 0
    ? Math.round(stats.totalRevenue / stats.paidOrders)
    : 0;

  this.stats = stats;
  return stats;
};

/**
 * Method: Smenani yopish
 */
shiftSchema.methods.closeShift = async function(closedById, closingCash, closingNotes = '') {
  // Statistikani hisoblash
  await this.calculateStats();

  this.status = 'closed';
  this.closedAt = new Date();
  this.closedBy = closedById;
  this.closingCash = closingCash;

  // Kutilgan kassa = boshlang'ich + naqd to'lovlar
  this.expectedClosingCash = this.openingCash + this.stats.cashPayments;
  this.cashDifference = closingCash - this.expectedClosingCash;
  this.closingNotes = closingNotes;

  return this.save();
};

/**
 * Method: To'lanmagan buyurtmalarni yangi smenaga o'tkazish
 */
shiftSchema.methods.transferUnpaidOrders = async function(newShiftId) {
  const Order = mongoose.model('Order');

  // Bu smenadagi to'lanmagan buyurtmalarni topish
  const unpaidOrders = await Order.find({
    shiftId: this._id,
    isPaid: false,
    status: { $nin: ['paid', 'cancelled'] }
  });

  const transferredIds = [];

  for (const order of unpaidOrders) {
    order.shiftId = newShiftId;
    order.transferredFromShiftId = this._id;
    order.transferredToShiftAt = new Date();
    await order.save();
    transferredIds.push(order._id);
  }

  this.transferredOrderIds = transferredIds;
  await this.save();

  return transferredIds;
};

/**
 * Virtual: Smena davomiyligi (soatlarda)
 */
shiftSchema.virtual('duration').get(function() {
  const endTime = this.closedAt || new Date();
  const diffMs = endTime - this.openedAt;
  return Math.round(diffMs / (1000 * 60 * 60) * 10) / 10; // Soatlarda, 1 decimal
});

/**
 * Virtual: Smena davomiyligi (o'qilishi oson)
 */
shiftSchema.virtual('durationFormatted').get(function() {
  const endTime = this.closedAt || new Date();
  const diffMs = endTime - this.openedAt;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours} soat ${minutes} daqiqa`;
});

const Shift = mongoose.model('Shift', shiftSchema);

module.exports = Shift;
