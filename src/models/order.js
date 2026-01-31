const mongoose = require('mongoose');
const softDeletePlugin = require('./plugins/softDelete');

/**
 * Order Item Sub-Schema
 * Each item in an order with its own tracking
 */
const orderItemSchema = new mongoose.Schema({
  foodId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Food',
    required: true
  },
  foodName: {
    type: String,
    required: true
  },
  categoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  categoryName: String,

  quantity: {
    type: Number,
    required: true,
    min: [1, 'Quantity must be at least 1']
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },

  // Kitchen tracking
  status: {
    type: String,
    enum: ['pending', 'preparing', 'ready', 'served', 'cancelled'],
    default: 'pending'
  },

  // Tayyorlash boshlandi - oshpaz boshlagan vaqt
  isStarted: {
    type: Boolean,
    default: false
  },
  startedAt: Date,
  startedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  startedByName: String,

  // Tayyor bo'lgan vaqt va davomiyligi
  readyQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  readyAt: Date,
  servedAt: Date,

  // Tayyorlash davomiyligi (millisekundlarda)
  preparationDuration: {
    type: Number,
    default: 0
  },

  // Item history - kim qo'shganini kuzatish (TZ 3.2)
  addedAt: {
    type: Date,
    default: Date.now
  },
  addedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  addedByName: String,

  // Bekor qilish tarixi (TZ 1.1)
  cancelledAt: Date,
  cancelReason: String,
  cancelledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  cancelledByName: String,

  // Soft delete at item level
  isDeleted: {
    type: Boolean,
    default: false
  },
  deletedAt: Date,
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },

  // Payment tracking per item (Partial Payment)
  isPaid: {
    type: Boolean,
    default: false
  },
  paidAt: Date,
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  paidByName: String,
  paymentSessionId: String,
  itemPaymentType: {
    type: String,
    enum: ['cash', 'card', 'click', null],
    default: null
  },

  // 🖨️ Printer Status Tracking - cook offline bo'lganda ham print qilish uchun
  printerStatus: {
    type: String,
    enum: ['pending', 'queued', 'printed'],
    default: 'pending'
  },
  queuedAt: Date,
  printedAt: Date
}, { _id: true });

// Item methods
orderItemSchema.methods.softDelete = function(deletedById = null) {
  this.isDeleted = true;
  this.deletedAt = new Date();
  if (deletedById) this.deletedBy = deletedById;
};

// Tayyorlashni boshlash
orderItemSchema.methods.markStarted = function(startedById = null, startedByName = null) {
  this.isStarted = true;
  this.startedAt = new Date();
  this.status = 'preparing';
  if (startedById) this.startedBy = startedById;
  if (startedByName) this.startedByName = startedByName;
};

// Tayyorlashni tugatish - davomiylikni hisoblash
orderItemSchema.methods.markReady = function(quantity = null) {
  const readyQty = quantity !== null ? quantity : this.quantity;
  this.readyQuantity = Math.min(readyQty, this.quantity);
  if (this.readyQuantity >= this.quantity) {
    this.status = 'ready';
    this.readyAt = new Date();
    this.isStarted = false; // Tayyor bo'lganda isStarted false

    // Tayyorlash davomiyligini hisoblash
    if (this.startedAt) {
      this.preparationDuration = this.readyAt.getTime() - new Date(this.startedAt).getTime();
    }
  } else if (this.readyQuantity > 0) {
    this.status = 'preparing';
  }
};

orderItemSchema.methods.markServed = function() {
  this.status = 'served';
  this.servedAt = new Date();
};

/**
 * Main Order Schema
 * Single source of truth for all order data
 */
const orderSchema = new mongoose.Schema({
  restaurantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: [true, 'Restaurant ID is required'],
    index: true
  },

  // Smena ID - buyurtma qaysi smenada yaratilganini ko'rsatadi
  shiftId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shift',
    index: true,
    default: null
  },

  // Smena o'tkazish (transfer) uchun
  transferredFromShiftId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Shift',
    default: null
  },
  transferredToShiftAt: {
    type: Date,
    default: null
  },

  // Order identification
  orderNumber: {
    type: Number,
    required: true
  },
  orderType: {
    type: String,
    enum: ['dine-in', 'saboy', 'takeaway'],
    default: 'dine-in'
  },
  saboyNumber: Number,

  // Table info
  tableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  },
  tableName: String,
  tableNumber: Number,

  // Items (SINGLE array - no more allOrders/selectFoods confusion)
  items: [orderItemSchema],

  // Financial
  subtotal: {
    type: Number,
    default: 0,
    min: 0
  },
  serviceCharge: {
    type: Number,
    default: 0,
    min: 0
  },
  serviceChargePercent: {
    type: Number,
    default: 10,
    min: 0,
    max: 100
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  discountPercent: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  surcharge: {
    type: Number,
    default: 0,
    min: 0
  },
  // Bandlik haqi (kabinalar uchun soatlik to'lov)
  hourlyCharge: {
    type: Number,
    default: 0,
    min: 0
  },
  hourlyChargeHours: {
    type: Number,
    default: 0,
    min: 0
  },
  hourlyChargeAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  hasHourlyCharge: {
    type: Boolean,
    default: false
  },
  grandTotal: {
    type: Number,
    default: 0,
    min: 0
  },

  // Order status
  status: {
    type: String,
    enum: ['pending', 'approved', 'preparing', 'ready', 'served', 'paid', 'cancelled'],
    default: 'pending',
    index: true
  },

  // Waiter info
  waiterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    index: true
  },
  waiterName: String,

  // Approval workflow (for customer-created orders)
  waiterApproved: {
    type: Boolean,
    default: false
  },
  approvedAt: Date,
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  waiterRejected: {
    type: Boolean,
    default: false
  },
  rejectedAt: Date,
  rejectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  rejectionReason: String,

  // Kitchen tracking
  allItemsReady: {
    type: Boolean,
    default: false
  },
  notifiedWaiter: {
    type: Boolean,
    default: false
  },
  notifiedAt: Date,

  // Payment
  isPaid: {
    type: Boolean,
    default: false,
    index: true
  },
  paymentType: {
    type: String,
    enum: ['cash', 'card', 'click', 'mixed', null],
    default: null
  },
  paymentSplit: {
    cash: { type: Number, default: 0, min: 0 },
    card: { type: Number, default: 0, min: 0 },
    click: { type: Number, default: 0, min: 0 }
  },
  paidAt: Date,
  paidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  paymentComment: String,

  // Source tracking
  source: {
    type: String,
    enum: ['waiter', 'customer', 'admin', 'cashier'],
    default: 'waiter'
  },

  // Timestamps
  orderedAt: {
    type: Date,
    default: Date.now
  },
  servedAt: Date,

  // General comment
  comment: String,

  // === TZ 3.1: Shaxsiy buyurtma (ofitsiant o'zi uchun) ===
  isPersonalOrder: {
    type: Boolean,
    default: false
  },
  personalOrderStaffId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  deductFromSalary: {
    type: Boolean,
    default: false
  },
  salaryDeducted: {
    type: Boolean,
    default: false
  },
  salaryDeductedAt: Date,

  // === TZ 3.5-3.6: Stol ko'chirish va xizmat haqi qoidalari ===
  originalTableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  },
  originalWaiterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  },
  originalWaiterName: String,
  transferredAt: Date,
  transferredFromTableId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table'
  },
  transferHistory: [{
    fromTableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table' },
    toTableId: { type: mongoose.Schema.Types.ObjectId, ref: 'Table' },
    fromWaiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    toWaiterId: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' },
    transferredAt: { type: Date, default: Date.now },
    transferredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Staff' }
  }],

  // Xizmat haqini qaysi ofitsiantga yozish kerak
  serviceChargeWaiterId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Apply soft delete plugin
orderSchema.plugin(softDeletePlugin);

// Indexes for common queries
orderSchema.index({ restaurantId: 1, createdAt: -1 });
orderSchema.index({ restaurantId: 1, status: 1 });
orderSchema.index({ restaurantId: 1, isPaid: 1 });
orderSchema.index({ restaurantId: 1, waiterId: 1, isPaid: 1 });
orderSchema.index({ restaurantId: 1, tableId: 1, isPaid: 1 });
orderSchema.index({ restaurantId: 1, shiftId: 1 });
orderSchema.index({ shiftId: 1, isPaid: 1 });

// Virtual: Active items (non-deleted)
orderSchema.virtual('activeItems').get(function() {
  return this.items.filter(item => !item.isDeleted);
});

// Virtual: Total item count
orderSchema.virtual('totalItemCount').get(function() {
  return this.activeItems.reduce((sum, item) => sum + item.quantity, 0);
});

// Virtual: Ready item count
orderSchema.virtual('readyItemCount').get(function() {
  return this.activeItems.reduce((sum, item) => sum + item.readyQuantity, 0);
});

// Virtual: Waiter info populated
orderSchema.virtual('waiter', {
  ref: 'Staff',
  localField: 'waiterId',
  foreignField: '_id',
  justOne: true
});

// Pre-save: Calculate totals
orderSchema.pre('save', function(next) {
  this.recalculateTotals();
  next();
});

// Method: Recalculate totals
orderSchema.methods.recalculateTotals = function() {
  const activeItems = this.items.filter(item => !item.isDeleted);

  // Calculate subtotal
  this.subtotal = activeItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // TZ 2.1: Olib ketish (takeaway) va saboy buyurtmalaridan xizmat haqi olinmaydi
  if (this.orderType === 'takeaway' || this.orderType === 'saboy') {
    this.serviceCharge = 0;
    this.serviceChargePercent = 0;
  } else {
    // Calculate service charge
    this.serviceCharge = Math.round(this.subtotal * (this.serviceChargePercent / 100));
  }

  // Calculate discount if percent-based
  if (this.discountPercent > 0) {
    this.discount = Math.round(this.subtotal * (this.discountPercent / 100));
  }

  // Calculate grand total (bandlik haqi bilan)
  this.grandTotal = this.subtotal + this.serviceCharge + this.surcharge + (this.hourlyCharge || 0) - this.discount;

  // Check if all items are ready
  this.allItemsReady = activeItems.length > 0 &&
    activeItems.every(item => item.readyQuantity >= item.quantity);

  // Update order status based on item states
  this.updateStatusFromItems();

  return this;
};

// Method: Update order status based on items
orderSchema.methods.updateStatusFromItems = function() {
  const activeItems = this.items.filter(item => !item.isDeleted);

  if (activeItems.length === 0) return;

  // Don't change status if paid or cancelled
  if (this.status === 'paid' || this.status === 'cancelled') return;

  const allReady = activeItems.every(item => item.status === 'ready' || item.status === 'served');
  const allServed = activeItems.every(item => item.status === 'served');
  const anyPreparing = activeItems.some(item => item.status === 'preparing' || item.readyQuantity > 0);
  const anyPending = activeItems.some(item => item.status === 'pending');

  if (allServed) {
    this.status = 'served';
  } else if (allReady) {
    this.status = 'ready';
  } else if (anyPreparing || anyPending) {
    this.status = 'preparing';
  }
};

// Method: Add item
orderSchema.methods.addItem = function(itemData) {
  const existingItem = this.items.find(item =>
    !item.isDeleted &&
    item.foodId.toString() === itemData.foodId.toString()
  );

  if (existingItem) {
    existingItem.quantity += itemData.quantity || 1;
    // Agar item ready/served bo'lsa, yangi quantity qo'shilganda pending ga qaytarish
    if (['ready', 'served'].includes(existingItem.status)) {
      existingItem.status = 'pending';
      existingItem.isStarted = false;
    }
  } else {
    this.items.push({
      ...itemData,
      addedAt: new Date()
    });
  }

  this.recalculateTotals();
  return this;
};

// Method: Remove item (soft delete)
orderSchema.methods.removeItem = function(itemId, deletedById = null) {
  const item = this.items.id(itemId);
  if (item) {
    item.softDelete(deletedById);
    this.recalculateTotals();

    // If no active items left, mark order for deletion
    if (this.activeItems.length === 0) {
      this.isDeleted = true;
      this.deletedAt = new Date();
      if (deletedById) this.deletedBy = deletedById;
    }
  }
  return this;
};

// Method: Update item quantity
orderSchema.methods.updateItemQuantity = function(itemId, quantity) {
  const item = this.items.id(itemId);
  if (item && !item.isDeleted) {
    item.quantity = quantity;
    // Adjust readyQuantity if needed
    if (item.readyQuantity > quantity) {
      item.readyQuantity = quantity;
    }
    this.recalculateTotals();
  }
  return this;
};

// Method: Process payment
orderSchema.methods.processPayment = async function(paymentType, paidById, paymentSplit = null, comment = null) {
  console.log(`[processPayment] START - orderId=${this._id}, tableId=${this.tableId}`);
  console.log(`[processPayment] Order fields: hasHourlyCharge=${this.hasHourlyCharge}, hourlyChargeAmount=${this.hourlyChargeAmount}, hourlyCharge=${this.hourlyCharge}`);

  // Bandlik haqini hisoblash
  // Agar orderda hourly charge ma'lumotlari yo'q bo'lsa, table dan olish
  let hasHourly = this.hasHourlyCharge;
  let hourlyAmount = this.hourlyChargeAmount;

  console.log(`[processPayment] Initial: hasHourly=${hasHourly}, hourlyAmount=${hourlyAmount}`);

  // Agar orderda ma'lumot yo'q bo'lsa, table dan olish (eski orderlar uchun)
  if (!hasHourly && this.tableId) {
    console.log(`[processPayment] No hourly in order, fetching from table: ${this.tableId}`);
    const Table = require('./table');
    const table = await Table.findById(this.tableId);
    console.log(`[processPayment] Table found:`, table ? { hasHourlyCharge: table.hasHourlyCharge, hourlyChargeAmount: table.hourlyChargeAmount } : 'null');
    if (table && table.hasHourlyCharge && table.hourlyChargeAmount > 0) {
      hasHourly = true;
      hourlyAmount = table.hourlyChargeAmount;
      // Orderga ham saqlash
      this.hasHourlyCharge = true;
      this.hourlyChargeAmount = hourlyAmount;
      console.log(`[processPayment] Set from table: hasHourly=${hasHourly}, hourlyAmount=${hourlyAmount}`);
    }
  }

  console.log(`[processPayment] After table check: hasHourly=${hasHourly}, hourlyAmount=${hourlyAmount}`);

  // Bandlik haqini hisoblash (agar stol soatlik to'lovga ega bo'lsa)
  if (hasHourly && hourlyAmount > 0) {
    const createdAt = new Date(this.createdAt);
    const now = new Date();
    const diffMs = now.getTime() - createdAt.getTime();
    const diffHours = diffMs / (1000 * 60 * 60);

    // Birinchi soat boshidanoq hisoblanadi:
    // 0-59 daqiqa = 1 soat, 60-119 daqiqa = 2 soat, va hokazo
    const hours = Math.floor(diffHours) + 1;
    const hourlyCharge = hours * hourlyAmount;

    this.hourlyChargeHours = hours;
    this.hourlyCharge = hourlyCharge;

    // Grand total ni qayta hisoblash (bandlik bilan)
    this.grandTotal = this.subtotal + this.serviceCharge + this.surcharge + hourlyCharge - this.discount;

    console.log(`[Payment] Order ${this._id}: hourlyCharge=${hourlyCharge}, hours=${hours}, grandTotal=${this.grandTotal}`);
  } else {
    console.log(`[processPayment] No hourly charge applied: hasHourly=${hasHourly}, hourlyAmount=${hourlyAmount}`);
  }

  console.log(`[processPayment] FINAL VALUES: subtotal=${this.subtotal}, serviceCharge=${this.serviceCharge}, hourlyCharge=${this.hourlyCharge}, grandTotal=${this.grandTotal}`);

  this.isPaid = true;
  this.status = 'paid';
  this.paymentType = paymentType;
  this.paidAt = new Date();
  this.paidBy = paidById;

  if (paymentSplit) {
    this.paymentSplit = paymentSplit;
  }
  if (comment) {
    this.paymentComment = comment;
  }

  return this.save();
};

// Method: Approve order (waiter approves customer order)
orderSchema.methods.approve = function(approvedById) {
  this.waiterApproved = true;
  this.approvedAt = new Date();
  this.approvedBy = approvedById;
  this.status = 'approved';
  return this;
};

// Method: Reject order
orderSchema.methods.reject = function(rejectedById, reason = null) {
  this.waiterRejected = true;
  this.rejectedAt = new Date();
  this.rejectedBy = rejectedById;
  this.rejectionReason = reason;
  this.status = 'cancelled';
  return this;
};

// TZ 1.1: Admin uchun itemni bekor qilish (cancel, not delete)
orderSchema.methods.cancelItem = function(itemId, cancelledById, cancelledByName, reason = null) {
  const item = this.items.id(itemId);
  if (item && !item.isDeleted) {
    item.status = 'cancelled';
    item.cancelledAt = new Date();
    item.cancelledBy = cancelledById;
    item.cancelledByName = cancelledByName;
    item.cancelReason = reason;
    this.recalculateTotals();
  }
  return this;
};

// TZ 3.5-3.6: Stolni ko'chirish
orderSchema.methods.transferToTable = function(newTableId, newWaiterId, newWaiterName, transferredById) {
  // Transfer tarixini saqlash
  this.transferHistory.push({
    fromTableId: this.tableId,
    toTableId: newTableId,
    fromWaiterId: this.waiterId,
    toWaiterId: newWaiterId,
    transferredAt: new Date(),
    transferredBy: transferredById
  });

  // Original ma'lumotlarni saqlash (agar birinchi marta ko'chirilayotgan bo'lsa)
  if (!this.originalTableId) {
    this.originalTableId = this.tableId;
    this.originalWaiterId = this.waiterId;
    this.originalWaiterName = this.waiterName;
  }

  // Xizmat haqi qoidasi: birinchi ofitsiantga yoziladi
  if (!this.serviceChargeWaiterId) {
    this.serviceChargeWaiterId = this.originalWaiterId || this.waiterId;
  }

  this.transferredFromTableId = this.tableId;
  this.transferredAt = new Date();
  this.tableId = newTableId;

  // Agar yangi stol biriktirilgan ofitsiant bor bo'lsa
  if (newWaiterId) {
    this.waiterId = newWaiterId;
    this.waiterName = newWaiterName;
  }

  return this;
};

// ============== PARTIAL PAYMENT METHODS ==============

// Method: Get unpaid items
orderSchema.methods.getUnpaidItems = function() {
  return this.items.filter(item =>
    !item.isDeleted &&
    item.status !== 'cancelled' &&
    !item.isPaid
  );
};

// Method: Get paid items
orderSchema.methods.getPaidItems = function() {
  return this.items.filter(item =>
    !item.isDeleted &&
    item.status !== 'cancelled' &&
    item.isPaid
  );
};

// Method: Check if all items are paid
orderSchema.methods.areAllItemsPaid = function() {
  const activeItems = this.items.filter(item =>
    !item.isDeleted && item.status !== 'cancelled'
  );
  return activeItems.length > 0 && activeItems.every(item => item.isPaid);
};

// Method: Calculate unpaid total (with proportional service charge)
orderSchema.methods.getUnpaidTotal = function() {
  const unpaidItems = this.getUnpaidItems();
  const subtotal = unpaidItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  // Takeaway va saboy uchun xizmat haqi yo'q
  if (this.orderType === 'takeaway' || this.orderType === 'saboy') {
    return subtotal;
  }

  const serviceCharge = Math.round(subtotal * (this.serviceChargePercent / 100));
  return subtotal + serviceCharge;
};

// Method: Calculate paid total
orderSchema.methods.getPaidTotal = function() {
  const paidItems = this.getPaidItems();
  const subtotal = paidItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

  if (this.orderType === 'takeaway' || this.orderType === 'saboy') {
    return subtotal;
  }

  const serviceCharge = Math.round(subtotal * (this.serviceChargePercent / 100));
  return subtotal + serviceCharge;
};

// Method: Process partial payment (pay selected items)
orderSchema.methods.processPartialPayment = function(itemIds, paymentType, paidById, paidByName, paymentSplit = null, comment = null) {
  const now = new Date();
  const sessionId = new mongoose.Types.ObjectId().toString();

  // Get items to pay
  const itemsToPay = this.items.filter(item =>
    itemIds.includes(item._id.toString()) &&
    !item.isDeleted &&
    item.status !== 'cancelled' &&
    !item.isPaid
  );

  if (itemsToPay.length === 0) {
    throw new Error('To\'lanadigan item topilmadi');
  }

  // Calculate totals for these items
  const subtotal = itemsToPay.reduce((sum, item) => sum + (item.price * item.quantity), 0);
  let serviceCharge = 0;

  if (this.orderType !== 'takeaway' && this.orderType !== 'saboy') {
    serviceCharge = Math.round(subtotal * (this.serviceChargePercent / 100));
  }

  const total = subtotal + serviceCharge;

  // Mark items as paid
  for (const item of itemsToPay) {
    item.isPaid = true;
    item.paidAt = now;
    item.paidBy = paidById;
    item.paidByName = paidByName;
    item.paymentSessionId = sessionId;
    item.itemPaymentType = paymentType;
  }

  // Check if all items are now paid
  const allPaid = this.areAllItemsPaid();
  if (allPaid) {
    this.isPaid = true;
    this.status = 'paid';
    this.paidAt = now;
    this.paidBy = paidById;
    this.paymentType = 'mixed'; // Ko'p to'lov bo'lgani uchun
  }

  return {
    sessionId,
    paidItems: itemsToPay.map(item => ({
      itemId: item._id,
      foodName: item.foodName,
      quantity: item.quantity,
      price: item.price,
      subtotal: item.price * item.quantity
    })),
    subtotal,
    serviceCharge,
    total,
    paymentType,
    paymentSplit,
    allItemsPaid: allPaid,
    remainingTotal: this.getUnpaidTotal(),
    paidAt: now,
    comment
  };
};

// Static: Get today's orders
orderSchema.statics.getTodayOrders = function(restaurantId, filter = {}) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  return this.find({
    restaurantId,
    createdAt: { $gte: startOfDay },
    ...filter
  }).sort({ createdAt: -1 });
};

// Static: Get active orders (not paid)
orderSchema.statics.getActiveOrders = function(restaurantId) {
  return this.find({
    restaurantId,
    isPaid: false,
    status: { $nin: ['paid', 'cancelled'] }
  }).sort({ createdAt: -1 });
};

// Static: Get daily summary
orderSchema.statics.getDailySummary = async function(restaurantId, date = new Date()) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await this.aggregate([
    {
      $match: {
        restaurantId: new mongoose.Types.ObjectId(restaurantId),
        createdAt: { $gte: startOfDay, $lte: endOfDay },
        isDeleted: { $ne: true },
        status: { $ne: 'cancelled' } // Bekor qilingan orderlarni hisoblamaslik
      }
    },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        paidOrders: { $sum: { $cond: ['$isPaid', 1, 0] } },
        totalRevenue: { $sum: { $cond: ['$isPaid', '$grandTotal', 0] } },
        cashRevenue: {
          $sum: {
            $cond: [
              { $and: ['$isPaid', { $eq: ['$paymentType', 'cash'] }] },
              '$grandTotal',
              { $cond: ['$isPaid', '$paymentSplit.cash', 0] }
            ]
          }
        },
        cardRevenue: {
          $sum: {
            $cond: [
              { $and: ['$isPaid', { $eq: ['$paymentType', 'card'] }] },
              '$grandTotal',
              { $cond: ['$isPaid', '$paymentSplit.card', 0] }
            ]
          }
        },
        clickRevenue: {
          $sum: {
            $cond: [
              { $and: ['$isPaid', { $eq: ['$paymentType', 'click'] }] },
              '$grandTotal',
              { $cond: ['$isPaid', '$paymentSplit.click', 0] }
            ]
          }
        }
      }
    }
  ]).option({ includeDeleted: false });

  return result[0] || {
    totalOrders: 0,
    paidOrders: 0,
    totalRevenue: 0,
    cashRevenue: 0,
    cardRevenue: 0,
    clickRevenue: 0
  };
};

// Static: Generate next order number
orderSchema.statics.getNextOrderNumber = async function(restaurantId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const lastOrder = await this.findOne({
    restaurantId,
    createdAt: { $gte: startOfDay }
  }).sort({ orderNumber: -1 }).setOptions({ includeDeleted: true });

  return lastOrder ? lastOrder.orderNumber + 1 : 1;
};

const Order = mongoose.model('Order', orderSchema);

module.exports = Order;
