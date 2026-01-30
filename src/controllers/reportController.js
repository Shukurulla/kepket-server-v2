const { Order, Food, Staff, Table, Category, Shift } = require('../models');
const mongoose = require('mongoose');

// Helper function to get date range
const getDateRange = (period) => {
  const now = new Date();
  const start = new Date();
  const end = new Date();

  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week':
      start.setDate(start.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'year':
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      break;
    default:
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
  }

  return { start, end };
};

// Get dashboard summary
exports.getDashboard = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { period = 'today', allShifts, shiftId } = req.query;
    const { start, end } = getDateRange(period);

    // Smena filteri
    let orderFilter = {
      restaurantId,
      status: { $ne: 'cancelled' }
    };

    // MUHIM: Frontend dan kelgan shiftId ga ustuvorlik
    if (shiftId && shiftId.trim() !== '') {
      // Frontend aniq shiftId yuborgan - shu smenani ko'rsatish
      try {
        orderFilter.shiftId = new mongoose.Types.ObjectId(shiftId);
      } catch (err) {
        // Invalid ObjectId - bo'sh statistika qaytarish
        return res.json({
          success: true,
          data: {
            period,
            summary: {
              totalOrders: 0,
              completedOrders: 0,
              totalRevenue: 0,
              totalItems: 0,
              averageOrderValue: 0,
              activeTables: 0,
              totalTables: 0
            },
            topFoods: []
          }
        });
      }
    } else if (period === 'today' && allShifts !== 'true') {
      // ShiftId berilmagan va period=today - aktiv smenani aniqlash
      const activeShift = await Shift.getActiveShift(restaurantId);
      if (activeShift) {
        orderFilter.shiftId = activeShift._id;
      } else {
        // Aktiv smena yo'q - bo'sh statistika qaytarish
        return res.json({
          success: true,
          data: {
            period,
            summary: {
              totalOrders: 0,
              completedOrders: 0,
              totalRevenue: 0,
              totalItems: 0,
              averageOrderValue: 0,
              activeTables: 0,
              totalTables: 0
            },
            topFoods: []
          }
        });
      }
    } else {
      // Boshqa periodlar uchun sana bo'yicha filter
      orderFilter.createdAt = { $gte: start, $lte: end };
      // Faqat shiftId mavjud bo'lgan orderlarni olish
      orderFilter.shiftId = { $exists: true, $ne: null };
    }

    // Get orders in date range or by shift
    const rawOrders = await Order.find(orderFilter);

    // MUHIM: Qo'shimcha filter - shiftId bo'lmagan orderlarni chiqarib tashlash
    const orders = rawOrders.filter(order => {
      return order.shiftId && order.shiftId.toString().trim() !== '';
    });

    // Calculate metrics
    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.isPaid === true).length;

    // MUHIM: Bekor qilingan itemlarni hisobga olmaslik
    // Faqat aktiv itemlar summasi hisoblanadi (bandlik haqi bilan)
    const getOrderActiveTotal = (order) => {
      const activeItems = (order.items || []).filter(item =>
        !item.isDeleted && item.status !== 'cancelled' && !item.isCancelled
      );
      const activeFoodTotal = activeItems.reduce((sum, item) => sum + ((item.price || 0) * (item.quantity || 0)), 0);
      // Saboy/takeaway buyurtmalari uchun xizmat haqi 0
      const isSaboy = order.orderType === 'saboy' || order.orderType === 'takeaway';
      const activeServiceCharge = isSaboy ? 0 : Math.round(activeFoodTotal * 0.1);
      // Bandlik haqi (hourlyCharge) ni ham qo'shish
      const hourlyCharge = order.hourlyCharge || 0;
      return activeFoodTotal + activeServiceCharge + hourlyCharge;
    };

    const totalRevenue = orders
      .filter(o => o.isPaid === true)
      .reduce((sum, o) => sum + getOrderActiveTotal(o), 0);

    // Faqat aktiv itemlar soni
    const totalItems = orders.reduce((sum, o) => {
      const activeItems = (o.items || []).filter(item =>
        !item.isDeleted && item.status !== 'cancelled' && !item.isCancelled
      );
      return sum + activeItems.length;
    }, 0);

    // Get active tables
    const activeTables = await Table.countDocuments({
      restaurantId,
      status: 'occupied'
    });

    const totalTables = await Table.countDocuments({ restaurantId });

    // Get top foods (same filter as orders - by shift or date range)
    const aggregateFilter = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      status: { $ne: 'cancelled' }
    };

    // Agar shiftId bor bo'lsa - shiftId bo'yicha, aks holda sana bo'yicha
    if (orderFilter.shiftId) {
      aggregateFilter.shiftId = orderFilter.shiftId;
    } else {
      aggregateFilter.createdAt = { $gte: start, $lte: end };
    }

    const topFoods = await Order.aggregate([
      {
        $match: aggregateFilter
      },
      { $unwind: '$items' },
      // MUHIM: Bekor qilingan itemlarni chiqarib tashlash
      {
        $match: {
          'items.status': { $ne: 'cancelled' },
          'items.isCancelled': { $ne: true }
        }
      },
      {
        $group: {
          _id: '$items.foodId',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } }
        }
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: 'foods',
          localField: '_id',
          foreignField: '_id',
          as: 'food'
        }
      },
      { $unwind: '$food' },
      {
        $project: {
          _id: 1,
          name: '$food.foodName',
          image: '$food.image',
          totalQuantity: 1,
          totalRevenue: 1
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        period,
        summary: {
          totalOrders,
          completedOrders,
          totalRevenue,
          totalItems,
          averageOrderValue: totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0,
          activeTables,
          totalTables
        },
        topFoods
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get sales report
exports.getSalesReport = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { startDate, endDate, groupBy = 'day' } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    if (!startDate) {
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }
    end.setHours(23, 59, 59, 999);

    let dateFormat;
    switch (groupBy) {
      case 'hour':
        dateFormat = { $dateToString: { format: '%Y-%m-%d %H:00', date: '$createdAt' } };
        break;
      case 'day':
        dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
        break;
      case 'week':
        dateFormat = { $dateToString: { format: '%Y-W%V', date: '$createdAt' } };
        break;
      case 'month':
        dateFormat = { $dateToString: { format: '%Y-%m', date: '$createdAt' } };
        break;
      default:
        dateFormat = { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } };
    }

    const salesData = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          createdAt: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' },
          isPaid: true
        }
      },
      // MUHIM: Bekor qilingan itemlarni chiqarib, aktiv summa hisoblash
      {
        $addFields: {
          activeItems: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: {
                $and: [
                  { $ne: ['$$item.status', 'cancelled'] },
                  { $ne: ['$$item.isCancelled', true] },
                  { $ne: ['$$item.isDeleted', true] }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          activeFoodTotal: {
            $reduce: {
              input: '$activeItems',
              initialValue: 0,
              in: { $add: ['$$value', { $multiply: [{ $ifNull: ['$$this.price', 0] }, { $ifNull: ['$$this.quantity', 0] }] }] }
            }
          }
        }
      },
      {
        $addFields: {
          activeGrandTotal: {
            $add: ['$activeFoodTotal', { $round: [{ $multiply: ['$activeFoodTotal', 0.1] }, 0] }]
          }
        }
      },
      {
        $group: {
          _id: dateFormat,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$activeGrandTotal' },
          totalItems: { $sum: { $size: '$activeItems' } }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Calculate totals
    const totals = salesData.reduce((acc, day) => ({
      orders: acc.orders + day.totalOrders,
      revenue: acc.revenue + day.totalRevenue,
      items: acc.items + day.totalItems
    }), { orders: 0, revenue: 0, items: 0 });

    res.json({
      success: true,
      data: {
        startDate: start,
        endDate: end,
        groupBy,
        salesData,
        totals
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get food performance report
exports.getFoodReport = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { startDate, endDate, categoryId, startTime, endTime, shiftId } = req.query;

    // Toshkent timezone offset (UTC+5)
    const TASHKENT_OFFSET = 5 * 60; // minutlarda

    // Sanani Toshkent vaqtida yaratish
    const createDateInTashkent = (dateStr, hours = 0, minutes = 0, seconds = 0, ms = 0) => {
      const date = new Date(dateStr + 'T00:00:00.000Z');
      // Toshkent vaqtini UTC ga aylantirish
      date.setUTCHours(hours - 5, minutes, seconds, ms);
      return date;
    };

    const matchStage = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      status: { $ne: 'cancelled' }
    };

    let start, end;

    // ShiftId ga ustuvorlik
    if (shiftId && shiftId.trim() !== '') {
      try {
        matchStage.shiftId = new mongoose.Types.ObjectId(shiftId);
      } catch (err) {
        return res.json({
          success: true,
          data: { startDate: new Date(), endDate: new Date(), foods: [] }
        });
      }
    } else {
      // Sana bo'yicha filter
      if (!startDate) {
        start = new Date();
        start.setDate(start.getDate() - 30);
        start = createDateInTashkent(start.toISOString().split('T')[0], 0, 0, 0, 0);
      } else if (startTime) {
        const [hours, minutes] = startTime.split(':').map(Number);
        start = createDateInTashkent(startDate, hours, minutes, 0, 0);
      } else {
        start = createDateInTashkent(startDate, 0, 0, 0, 0);
      }

      if (!endDate) {
        end = new Date();
      } else {
        end = new Date(endDate + 'T00:00:00.000Z');
      }

      if (endTime) {
        const [hours, minutes] = endTime.split(':').map(Number);
        end = createDateInTashkent(endDate || new Date().toISOString().split('T')[0], hours, minutes, 59, 999);
      } else {
        end = createDateInTashkent(endDate || new Date().toISOString().split('T')[0], 23, 59, 59, 999);
      }

      matchStage.createdAt = { $gte: start, $lte: end };
    }

    const foodStats = await Order.aggregate([
      { $match: matchStage },
      { $unwind: '$items' },
      {
        $group: {
          _id: '$items.foodId',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          orderCount: { $sum: 1 }
        }
      },
      { $sort: { totalQuantity: -1 } },
      {
        $lookup: {
          from: 'foods',
          localField: '_id',
          foreignField: '_id',
          as: 'food'
        }
      },
      { $unwind: '$food' },
      {
        $lookup: {
          from: 'categories',
          localField: 'food.categoryId',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: '$food.foodName',
          image: '$food.image',
          price: '$food.price',
          categoryId: '$food.categoryId',
          categoryName: '$category.name',
          totalQuantity: 1,
          totalRevenue: 1,
          orderCount: 1
        }
      }
    ]);

    // Filter by category if provided
    const filteredStats = categoryId
      ? foodStats.filter(f => f.categoryId?.toString() === categoryId)
      : foodStats;

    res.json({
      success: true,
      data: {
        startDate: start,
        endDate: end,
        foods: filteredStats
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get staff performance report
exports.getStaffReport = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { startDate, endDate, role, shiftId } = req.query;

    const matchFilter = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      status: { $ne: 'cancelled' }
    };

    let start, end;

    // ShiftId ga ustuvorlik
    if (shiftId && shiftId.trim() !== '') {
      try {
        matchFilter.shiftId = new mongoose.Types.ObjectId(shiftId);
      } catch (err) {
        return res.json({
          success: true,
          data: { startDate: new Date(), endDate: new Date(), staff: [] }
        });
      }
    } else {
      start = startDate ? new Date(startDate) : new Date();
      end = endDate ? new Date(endDate) : new Date();

      if (!startDate) {
        start.setDate(start.getDate() - 30);
        start.setHours(0, 0, 0, 0);
      }
      end.setHours(23, 59, 59, 999);
      matchFilter.createdAt = { $gte: start, $lte: end };
    }

    // Get waiter performance
    const waiterStats = await Order.aggregate([
      {
        $match: matchFilter
      },
      // MUHIM: Bekor qilingan itemlarni chiqarib, aktiv summa hisoblash
      {
        $addFields: {
          activeItems: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: {
                $and: [
                  { $ne: ['$$item.status', 'cancelled'] },
                  { $ne: ['$$item.isCancelled', true] },
                  { $ne: ['$$item.isDeleted', true] }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          activeFoodTotal: {
            $reduce: {
              input: '$activeItems',
              initialValue: 0,
              in: { $add: ['$$value', { $multiply: [{ $ifNull: ['$$this.price', 0] }, { $ifNull: ['$$this.quantity', 0] }] }] }
            }
          }
        }
      },
      {
        $addFields: {
          // Saboy/takeaway buyurtmalari uchun xizmat haqi 0
          isSaboy: {
            $in: ['$orderType', ['saboy', 'takeaway']]
          }
        }
      },
      {
        $addFields: {
          activeServiceCharge: {
            $cond: ['$isSaboy', 0, { $round: [{ $multiply: ['$activeFoodTotal', 0.1] }, 0] }]
          }
        }
      },
      {
        $addFields: {
          activeGrandTotal: {
            $add: ['$activeFoodTotal', '$activeServiceCharge', { $ifNull: ['$hourlyCharge', 0] }]
          }
        }
      },
      {
        $group: {
          _id: '$waiterId',
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$activeGrandTotal' },
          completedOrders: {
            $sum: { $cond: [{ $eq: ['$isPaid', true] }, 1, 0] }
          }
        }
      },
      {
        $lookup: {
          from: 'staff',
          localField: '_id',
          foreignField: '_id',
          as: 'waiter'
        }
      },
      { $unwind: { path: '$waiter', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: { $concat: ['$waiter.firstName', ' ', '$waiter.lastName'] },
          role: '$waiter.role',
          totalOrders: 1,
          totalRevenue: 1,
          completedOrders: 1,
          completionRate: {
            $cond: [
              { $eq: ['$totalOrders', 0] },
              0,
              { $multiply: [{ $divide: ['$completedOrders', '$totalOrders'] }, 100] }
            ]
          }
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    // Filter by role if provided
    const filteredStats = role
      ? waiterStats.filter(s => s.role === role)
      : waiterStats;

    res.json({
      success: true,
      data: {
        startDate: start,
        endDate: end,
        staff: filteredStats
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get payment method breakdown
exports.getPaymentReport = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { startDate, endDate, shiftId } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    if (!startDate) {
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }
    end.setHours(23, 59, 59, 999);

    // Match filter - shiftId ga ustuvorlik
    const matchFilter = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isPaid: true
    };

    // MUHIM: Frontend dan kelgan shiftId ga ustuvorlik
    if (shiftId && shiftId.trim() !== '') {
      try {
        matchFilter.shiftId = new mongoose.Types.ObjectId(shiftId);
      } catch (err) {
        // Invalid ObjectId - bo'sh qaytarish
        return res.json({
          success: true,
          data: {
            startDate: start,
            endDate: end,
            totalRevenue: 0,
            paymentBreakdown: []
          }
        });
      }
    } else {
      matchFilter.createdAt = { $gte: start, $lte: end };
      // Faqat shiftId mavjud bo'lgan orderlarni olish
      matchFilter.shiftId = { $exists: true, $ne: null };
    }

    // MUHIM: shiftId mavjud va null emas ekanligini ta'minlash
    matchFilter.shiftId = matchFilter.shiftId || { $exists: true, $ne: null };

    const paymentStats = await Order.aggregate([
      {
        $match: {
          ...matchFilter,
          // Qo'shimcha: shiftId bo'sh string emas ekanligini tekshirish
          shiftId: matchFilter.shiftId
        }
      },
      {
        // Qo'shimcha filter - shiftId haqiqatan mavjud ekanligini tekshirish
        $match: {
          shiftId: { $exists: true, $ne: null, $ne: '' }
        }
      },
      // MUHIM: Bekor qilingan itemlarni chiqarib, aktiv summa hisoblash
      {
        $addFields: {
          activeItems: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: {
                $and: [
                  { $ne: ['$$item.status', 'cancelled'] },
                  { $ne: ['$$item.isCancelled', true] },
                  { $ne: ['$$item.isDeleted', true] }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          activeFoodTotal: {
            $reduce: {
              input: '$activeItems',
              initialValue: 0,
              in: { $add: ['$$value', { $multiply: [{ $ifNull: ['$$this.price', 0] }, { $ifNull: ['$$this.quantity', 0] }] }] }
            }
          }
        }
      },
      {
        $addFields: {
          // Saboy/takeaway buyurtmalari uchun xizmat haqi 0
          isSaboy: {
            $in: ['$orderType', ['saboy', 'takeaway']]
          }
        }
      },
      {
        $addFields: {
          activeServiceCharge: {
            $cond: ['$isSaboy', 0, { $round: [{ $multiply: ['$activeFoodTotal', 0.1] }, 0] }]
          }
        }
      },
      {
        $addFields: {
          // Aktiv grand total = taomlar + xizmat haqi + bandlik haqi
          activeGrandTotal: {
            $add: ['$activeFoodTotal', '$activeServiceCharge', { $ifNull: ['$hourlyCharge', 0] }]
          }
        }
      },
      // 🔑 Mixed to'lovlarni alohida cash, card, click ga bo'lish
      {
        $group: {
          _id: null,
          orders: { $push: '$$ROOT' },
          // Oddiy to'lovlar (non-mixed)
          cashTotal: {
            $sum: {
              $cond: [
                { $eq: ['$paymentType', 'cash'] },
                '$activeGrandTotal',
                0
              ]
            }
          },
          cardTotal: {
            $sum: {
              $cond: [
                { $eq: ['$paymentType', 'card'] },
                '$activeGrandTotal',
                0
              ]
            }
          },
          clickTotal: {
            $sum: {
              $cond: [
                { $eq: ['$paymentType', 'click'] },
                '$activeGrandTotal',
                0
              ]
            }
          },
          // Mixed to'lovlar - paymentSplit dan olish
          mixedCashTotal: {
            $sum: {
              $cond: [
                { $eq: ['$paymentType', 'mixed'] },
                { $ifNull: ['$paymentSplit.cash', 0] },
                0
              ]
            }
          },
          mixedCardTotal: {
            $sum: {
              $cond: [
                { $eq: ['$paymentType', 'mixed'] },
                { $ifNull: ['$paymentSplit.card', 0] },
                0
              ]
            }
          },
          mixedClickTotal: {
            $sum: {
              $cond: [
                { $eq: ['$paymentType', 'mixed'] },
                { $ifNull: ['$paymentSplit.click', 0] },
                0
              ]
            }
          },
          // Hisoblagichlar
          cashCount: {
            $sum: { $cond: [{ $eq: ['$paymentType', 'cash'] }, 1, 0] }
          },
          cardCount: {
            $sum: { $cond: [{ $eq: ['$paymentType', 'card'] }, 1, 0] }
          },
          clickCount: {
            $sum: { $cond: [{ $eq: ['$paymentType', 'click'] }, 1, 0] }
          },
          mixedCount: {
            $sum: { $cond: [{ $eq: ['$paymentType', 'mixed'] }, 1, 0] }
          }
        }
      },
      // Jami summalarni hisoblash
      {
        $project: {
          cashTotal: { $add: ['$cashTotal', '$mixedCashTotal'] },
          cardTotal: { $add: ['$cardTotal', '$mixedCardTotal'] },
          clickTotal: { $add: ['$clickTotal', '$mixedClickTotal'] },
          cashCount: '$cashCount',
          cardCount: '$cardCount',
          clickCount: '$clickCount',
          mixedCount: '$mixedCount'
        }
      }
    ]);

    // Natijalarni formatlash
    const stats = paymentStats[0] || {
      cashTotal: 0, cardTotal: 0, clickTotal: 0,
      cashCount: 0, cardCount: 0, clickCount: 0, mixedCount: 0
    };

    const totalRevenue = stats.cashTotal + stats.cardTotal + stats.clickTotal;

    // PaymentBreakdown formatini yaratish
    const paymentBreakdown = [];

    if (stats.cashTotal > 0 || stats.cashCount > 0) {
      paymentBreakdown.push({
        method: 'cash',
        count: stats.cashCount,
        total: stats.cashTotal,
        percentage: totalRevenue > 0 ? Math.round((stats.cashTotal / totalRevenue) * 100) : 0
      });
    }

    if (stats.cardTotal > 0 || stats.cardCount > 0) {
      paymentBreakdown.push({
        method: 'card',
        count: stats.cardCount,
        total: stats.cardTotal,
        percentage: totalRevenue > 0 ? Math.round((stats.cardTotal / totalRevenue) * 100) : 0
      });
    }

    if (stats.clickTotal > 0 || stats.clickCount > 0) {
      paymentBreakdown.push({
        method: 'click',
        count: stats.clickCount,
        total: stats.clickTotal,
        percentage: totalRevenue > 0 ? Math.round((stats.clickTotal / totalRevenue) * 100) : 0
      });
    }

    // Mixed to'lovlar sonini ham ko'rsatish (agar kerak bo'lsa)
    if (stats.mixedCount > 0) {
      paymentBreakdown.push({
        method: 'mixed',
        count: stats.mixedCount,
        total: 0, // Total allaqachon cash/card/click ga bo'lingan
        percentage: 0
      });
    }

    // Sort by total descending
    paymentBreakdown.sort((a, b) => b.total - a.total);

    res.json({
      success: true,
      data: {
        startDate: start,
        endDate: end,
        totalRevenue,
        paymentBreakdown
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get hourly analysis
exports.getHourlyAnalysis = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { date, shiftId } = req.query;

    const matchFilter = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      status: { $ne: 'cancelled' }
    };

    // ShiftId ga ustuvorlik
    if (shiftId && shiftId.trim() !== '') {
      try {
        matchFilter.shiftId = new mongoose.Types.ObjectId(shiftId);
      } catch (err) {
        return res.json({
          success: true,
          data: {
            date: new Date(),
            hourlyData: Array.from({ length: 24 }, (_, hour) => ({ hour, orderCount: 0, revenue: 0 })),
            peakHours: []
          }
        });
      }
    } else {
      const targetDate = date ? new Date(date) : new Date();
      const start = new Date(targetDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(targetDate);
      end.setHours(23, 59, 59, 999);
      matchFilter.createdAt = { $gte: start, $lte: end };
    }

    const hourlyStats = await Order.aggregate([
      {
        $match: matchFilter
      },
      // MUHIM: Bekor qilingan itemlarni chiqarib, aktiv summa hisoblash
      {
        $addFields: {
          activeItems: {
            $filter: {
              input: '$items',
              as: 'item',
              cond: {
                $and: [
                  { $ne: ['$$item.status', 'cancelled'] },
                  { $ne: ['$$item.isCancelled', true] },
                  { $ne: ['$$item.isDeleted', true] }
                ]
              }
            }
          }
        }
      },
      {
        $addFields: {
          activeFoodTotal: {
            $reduce: {
              input: '$activeItems',
              initialValue: 0,
              in: { $add: ['$$value', { $multiply: [{ $ifNull: ['$$this.price', 0] }, { $ifNull: ['$$this.quantity', 0] }] }] }
            }
          }
        }
      },
      {
        $addFields: {
          // Saboy/takeaway buyurtmalari uchun xizmat haqi 0
          isSaboy: {
            $in: ['$orderType', ['saboy', 'takeaway']]
          }
        }
      },
      {
        $addFields: {
          activeServiceCharge: {
            $cond: ['$isSaboy', 0, { $round: [{ $multiply: ['$activeFoodTotal', 0.1] }, 0] }]
          }
        }
      },
      {
        $addFields: {
          activeGrandTotal: {
            $add: ['$activeFoodTotal', '$activeServiceCharge', { $ifNull: ['$hourlyCharge', 0] }]
          }
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          orderCount: { $sum: 1 },
          revenue: { $sum: '$activeGrandTotal' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Fill in missing hours
    const fullHourlyData = Array.from({ length: 24 }, (_, hour) => {
      const found = hourlyStats.find(h => h._id === hour);
      return {
        hour,
        orderCount: found?.orderCount || 0,
        revenue: found?.revenue || 0
      };
    });

    // Find peak hours
    const sortedByOrders = [...fullHourlyData].sort((a, b) => b.orderCount - a.orderCount);
    const peakHours = sortedByOrders.slice(0, 3).map(h => h.hour);

    res.json({
      success: true,
      data: {
        date: targetDate,
        hourlyData: fullHourlyData,
        peakHours
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get category performance
exports.getCategoryReport = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    if (!startDate) {
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }
    end.setHours(23, 59, 59, 999);

    const categoryStats = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          createdAt: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' }
        }
      },
      { $unwind: '$items' },
      {
        $lookup: {
          from: 'foods',
          localField: 'items.foodId',
          foreignField: '_id',
          as: 'food'
        }
      },
      { $unwind: '$food' },
      {
        $group: {
          _id: '$food.categoryId',
          totalQuantity: { $sum: '$items.quantity' },
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          itemCount: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'categories',
          localField: '_id',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: { path: '$category', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 1,
          name: '$category.name',
          totalQuantity: 1,
          totalRevenue: 1,
          itemCount: 1
        }
      },
      { $sort: { totalRevenue: -1 } }
    ]);

    const totalRevenue = categoryStats.reduce((sum, c) => sum + c.totalRevenue, 0);

    const categoriesWithPercentage = categoryStats.map(c => ({
      ...c,
      percentage: totalRevenue > 0 ? Math.round((c.totalRevenue / totalRevenue) * 100) : 0
    }));

    res.json({
      success: true,
      data: {
        startDate: start,
        endDate: end,
        categories: categoriesWithPercentage,
        totalRevenue
      }
    });
  } catch (error) {
    next(error);
  }
};
