const { Order, Staff, Category, Food, Shift } = require('../models');
const mongoose = require('mongoose');

/**
 * Hisobot Controller
 * To'langan buyurtmalar asosida hisobotlar
 * hisobot.md ga asoslangan
 */

// Toshkent timezone helper (UTC+5)
const getTashkentDateRange = (startDateStr, endDateStr, startTime, endTime) => {
  const TASHKENT_OFFSET = 5; // UTC+5

  let start, end;

  if (startDateStr) {
    start = new Date(startDateStr + 'T00:00:00.000Z');
    if (startTime) {
      const [hours, minutes] = startTime.split(':').map(Number);
      start.setUTCHours(hours - TASHKENT_OFFSET, minutes, 0, 0);
    } else {
      start.setUTCHours(0 - TASHKENT_OFFSET, 0, 0, 0);
    }
  } else {
    start = new Date();
    start.setUTCHours(0 - TASHKENT_OFFSET, 0, 0, 0);
  }

  if (endDateStr) {
    end = new Date(endDateStr + 'T00:00:00.000Z');
    if (endTime) {
      const [hours, minutes] = endTime.split(':').map(Number);
      end.setUTCHours(hours - TASHKENT_OFFSET, minutes, 59, 999);
    } else {
      end.setUTCHours(23 - TASHKENT_OFFSET, 59, 59, 999);
    }
  } else {
    end = new Date();
    end.setUTCHours(23 - TASHKENT_OFFSET, 59, 59, 999);
  }

  return { start, end };
};

// Period bo'yicha sana oralig'ini olish
const getDateRangeByPeriod = (period) => {
  const now = new Date();
  const today = now.toISOString().split('T')[0];

  switch (period) {
    case 'today':
      return getTashkentDateRange(today, today);
    case 'yesterday': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      return getTashkentDateRange(yesterdayStr, yesterdayStr);
    }
    case 'week': {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - 7);
      return getTashkentDateRange(weekStart.toISOString().split('T')[0], today);
    }
    case '10days': {
      const tenDaysAgo = new Date(now);
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
      return getTashkentDateRange(tenDaysAgo.toISOString().split('T')[0], today);
    }
    case 'month': {
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return getTashkentDateRange(monthStart.toISOString().split('T')[0], today);
    }
    default:
      return getTashkentDateRange(today, today);
  }
};

/**
 * ASOSIY HISOBOT - Barcha ma'lumotlar bir joyda
 * GET /api/hisobot
 */
exports.getFullReport = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { period = 'today', startDate, endDate, startTime, endTime } = req.query;

    // Sana oralig'ini aniqlash
    let dateRange;
    if (startDate || endDate) {
      dateRange = getTashkentDateRange(startDate, endDate, startTime, endTime);
    } else {
      dateRange = getDateRangeByPeriod(period);
      if (startTime || endTime) {
        dateRange = getTashkentDateRange(
          dateRange.start.toISOString().split('T')[0],
          dateRange.end.toISOString().split('T')[0],
          startTime,
          endTime
        );
      }
    }

    const { start, end } = dateRange;

    // Aktiv smenani tekshirish (bugungi hisobot uchun shift bo'yicha filter)
    const orderQuery = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isPaid: true,
      paidAt: { $gte: start, $lte: end },
      status: { $ne: 'cancelled' }
    };

    // Bugungi hisobot uchun aktiv smena bo'yicha filter
    if (period === 'today') {
      const activeShift = await Shift.getActiveShift(restaurantId);
      if (activeShift) {
        orderQuery.shiftId = activeShift._id;
      }
    }

    const paidOrders = await Order.find(orderQuery).lean();

    // ==========================================
    // 1. SOTUV HISOBOTI (SALES REPORT)
    // ==========================================

    // Umumiy tushum
    const totalRevenue = paidOrders.reduce((sum, order) => sum + (order.grandTotal || 0), 0);

    // Taomlar summasi (subtotal)
    const foodRevenue = paidOrders.reduce((sum, order) => sum + (order.subtotal || 0), 0);

    // Xizmat haqi (service charge - 10%)
    const serviceRevenue = paidOrders.reduce((sum, order) => sum + (order.serviceCharge || 0), 0);

    // Cheklar soni
    const totalChecks = paidOrders.length;

    // O'rtacha chek
    const averageCheck = totalChecks > 0 ? Math.round(totalRevenue / totalChecks) : 0;

    // ==========================================
    // 2. TO'LOV USULLARI (PAYMENT METHODS)
    // ==========================================

    let cashTotal = 0;
    let cardTotal = 0;
    let clickTotal = 0;
    let cashCount = 0;
    let cardCount = 0;
    let clickCount = 0;
    let mixedCount = 0;

    paidOrders.forEach(order => {
      if (order.paymentType === 'cash') {
        cashTotal += order.grandTotal || 0;
        cashCount++;
      } else if (order.paymentType === 'card') {
        cardTotal += order.grandTotal || 0;
        cardCount++;
      } else if (order.paymentType === 'click') {
        clickTotal += order.grandTotal || 0;
        clickCount++;
      } else if (order.paymentType === 'mixed') {
        // Mixed payment - har bir turni alohida hisoblash
        cashTotal += order.paymentSplit?.cash || 0;
        cardTotal += order.paymentSplit?.card || 0;
        clickTotal += order.paymentSplit?.click || 0;
        mixedCount++;
      }
    });

    const paymentMethods = {
      cash: { total: cashTotal, count: cashCount, percentage: totalRevenue > 0 ? Math.round((cashTotal / totalRevenue) * 100) : 0 },
      card: { total: cardTotal, count: cardCount, percentage: totalRevenue > 0 ? Math.round((cardTotal / totalRevenue) * 100) : 0 },
      click: { total: clickTotal, count: clickCount, percentage: totalRevenue > 0 ? Math.round((clickTotal / totalRevenue) * 100) : 0 },
      mixed: { count: mixedCount }
    };

    // ==========================================
    // 3. OFITSIANTLAR HISOBOTI (STAFF REPORT)
    // ==========================================

    // Avval barcha waiter IDlarni yig'amiz
    const waiterIds = [...new Set(
      paidOrders
        .filter(order => order.waiterId)
        .map(order => order.waiterId.toString())
    )];

    // Faqat WAITER rollidagi xodimlarni olish
    const waiterStaff = await Staff.find({
      _id: { $in: waiterIds },
      role: 'waiter' // Faqat ofitsiantlar
    }).select('_id firstName lastName role').lean();

    const waiterIdSet = new Set(waiterStaff.map(w => w._id.toString()));
    const waiterNameMap = new Map(waiterStaff.map(w => [w._id.toString(), `${w.firstName} ${w.lastName}`]));

    const waiterMap = new Map();

    paidOrders.forEach(order => {
      const waiterId = order.waiterId?.toString();

      // Faqat waiter rollidagi xodimlarni hisoblash
      if (!waiterId || !waiterIdSet.has(waiterId)) return;

      const waiterName = waiterNameMap.get(waiterId) || order.waiterName || 'Noma\'lum';

      if (!waiterMap.has(waiterId)) {
        waiterMap.set(waiterId, {
          _id: waiterId,
          name: waiterName,
          totalOrders: 0,
          totalRevenue: 0,
          serviceRevenue: 0,
          cashRevenue: 0,
          cardRevenue: 0
        });
      }

      const waiter = waiterMap.get(waiterId);
      waiter.totalOrders++;
      waiter.totalRevenue += order.grandTotal || 0;
      waiter.serviceRevenue += order.serviceCharge || 0;

      if (order.paymentType === 'cash') {
        waiter.cashRevenue += order.grandTotal || 0;
      } else if (order.paymentType === 'card') {
        waiter.cardRevenue += order.grandTotal || 0;
      } else if (order.paymentType === 'mixed') {
        waiter.cashRevenue += order.paymentSplit?.cash || 0;
        waiter.cardRevenue += order.paymentSplit?.card || 0;
      }
    });

    // Ofitsiantlar ro'yxati - 5% ish haqi bilan
    const waiters = Array.from(waiterMap.values())
      .map(waiter => ({
        ...waiter,
        salary: Math.round(waiter.totalRevenue * 0.05), // 5% ish haqi
        averageCheck: waiter.totalOrders > 0 ? Math.round(waiter.totalRevenue / waiter.totalOrders) : 0
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    // Jami ofitsiantlar ish haqi (faqat ofitsiantlar tushumi asosida)
    const totalWaiterRevenue = waiters.reduce((sum, w) => sum + w.totalRevenue, 0);
    const totalWaiterSalary = Math.round(totalWaiterRevenue * 0.05);

    // Kategoriya nomlarini bazadan olish (food va category report uchun)
    const allCategories = await Category.find({}).lean();
    const categoryNameMap = new Map();
    allCategories.forEach(cat => {
      categoryNameMap.set(cat._id.toString(), cat.title || cat.name || 'Nomsiz');
    });

    // ==========================================
    // 4. TAOMLAR HISOBOTI (FOOD REPORT)
    // ==========================================

    const foodMap = new Map();

    paidOrders.forEach(order => {
      (order.items || []).forEach(item => {
        if (item.isDeleted || item.status === 'cancelled') return;

        const foodId = item.foodId?.toString() || item.foodName;

        if (!foodMap.has(foodId)) {
          foodMap.set(foodId, {
            _id: foodId,
            name: item.foodName,
            categoryId: item.categoryId,
            categoryName: categoryNameMap.get(item.categoryId?.toString()) || item.categoryName || 'Nomsiz',
            totalQuantity: 0,
            totalRevenue: 0,
            orderCount: 0,
            price: item.price
          });
        }

        const food = foodMap.get(foodId);
        food.totalQuantity += item.quantity || 0;
        food.totalRevenue += (item.price || 0) * (item.quantity || 0);
        food.orderCount++;
      });
    });

    const foods = Array.from(foodMap.values())
      .sort((a, b) => b.totalQuantity - a.totalQuantity);

    // ==========================================
    // 5. KATEGORIYALAR HISOBOTI
    // ==========================================

    const categoryMap = new Map();

    paidOrders.forEach(order => {
      (order.items || []).forEach(item => {
        if (item.isDeleted || item.status === 'cancelled') return;

        const categoryId = item.categoryId?.toString() || 'uncategorized';
        const categoryName = categoryNameMap.get(categoryId) || item.categoryName || 'Nomsiz';

        if (!categoryMap.has(categoryId)) {
          categoryMap.set(categoryId, {
            _id: categoryId,
            name: categoryName,
            totalQuantity: 0,
            totalRevenue: 0,
            itemCount: 0
          });
        }

        const category = categoryMap.get(categoryId);
        category.totalQuantity += item.quantity || 0;
        category.totalRevenue += (item.price || 0) * (item.quantity || 0);
        category.itemCount++;
      });
    });

    const categories = Array.from(categoryMap.values())
      .map(cat => ({
        ...cat,
        percentage: foodRevenue > 0 ? Math.round((cat.totalRevenue / foodRevenue) * 100) : 0
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    // ==========================================
    // 6. SOATLIK DINAMIKA (HOURLY ANALYSIS)
    // ==========================================

    const hourlyMap = new Map();

    // 24 soat uchun boshlang'ich qiymatlar
    for (let i = 0; i < 24; i++) {
      hourlyMap.set(i, { hour: i, orderCount: 0, revenue: 0 });
    }

    paidOrders.forEach(order => {
      if (order.paidAt) {
        // Toshkent vaqtiga o'tkazish (UTC+5)
        const paidDate = new Date(order.paidAt);
        const tashkentHour = (paidDate.getUTCHours() + 5) % 24;

        const hourData = hourlyMap.get(tashkentHour);
        hourData.orderCount++;
        hourData.revenue += order.grandTotal || 0;
      }
    });

    const hourlyData = Array.from(hourlyMap.values());

    // Pik soatlarni aniqlash (eng ko'p buyurtma bo'lgan 3 soat)
    const peakHours = [...hourlyData]
      .filter(h => h.orderCount > 0)
      .sort((a, b) => b.orderCount - a.orderCount)
      .slice(0, 3)
      .map(h => h.hour);

    // ==========================================
    // 7. SOF FOYDA (NET PROFIT)
    // Sof Foyda = Umumiy Tushum - Ofitsiantlar oyligi (5%)
    // Note: Mahsulot tannarxi hozircha hisoblanmaydi
    // ==========================================

    const netProfit = totalRevenue - totalWaiterSalary;

    // ==========================================
    // JAVOB
    // ==========================================

    res.json({
      success: true,
      data: {
        period: {
          type: period,
          startDate: start,
          endDate: end
        },

        // Sotuv hisoboti
        sales: {
          totalRevenue,      // Jami tushum
          foodRevenue,       // Taomlar summasi
          serviceRevenue,    // Xizmat haqi (10%)
          totalChecks,       // Cheklar soni
          averageCheck       // O'rtacha chek
        },

        // To'lov usullari
        paymentMethods,

        // Ofitsiantlar hisoboti
        staff: {
          waiters,
          totalWaiterSalary, // Jami ish haqi (5%)
          totalWaiters: waiters.length
        },

        // Taomlar statistikasi
        foods: {
          items: foods,
          totalFoodTypes: foods.length,
          totalSold: foods.reduce((sum, f) => sum + f.totalQuantity, 0)
        },

        // Kategoriyalar
        categories: {
          items: categories,
          totalCategories: categories.length
        },

        // Soatlik dinamika
        hourly: {
          data: hourlyData,
          peakHours,
          maxRevenue: Math.max(...hourlyData.map(h => h.revenue)),
          maxOrders: Math.max(...hourlyData.map(h => h.orderCount))
        },

        // Sof foyda
        profit: {
          netProfit,
          totalRevenue,
          waiterSalary: totalWaiterSalary,
          waiterSalaryPercent: 5
        }
      }
    });

  } catch (error) {
    console.error('Hisobot xatosi:', error);
    next(error);
  }
};

/**
 * TO'LANGAN BUYURTMALAR RO'YXATI
 * GET /api/hisobot/payments
 */
exports.getPaymentsList = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { period = 'today', startDate, endDate, startTime, endTime, paymentType } = req.query;

    let dateRange;
    if (startDate || endDate) {
      dateRange = getTashkentDateRange(startDate, endDate, startTime, endTime);
    } else {
      dateRange = getDateRangeByPeriod(period);
    }

    const { start, end } = dateRange;

    const query = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      isPaid: true,
      paidAt: { $gte: start, $lte: end },
      status: { $ne: 'cancelled' }
    };

    if (paymentType && paymentType !== 'all') {
      query.paymentType = paymentType;
    }

    // Bugungi hisobot uchun aktiv smena bo'yicha filter
    if (period === 'today') {
      const activeShift = await Shift.getActiveShift(restaurantId);
      if (activeShift) {
        query.shiftId = activeShift._id;
      }
    }

    const payments = await Order.find(query)
      .select('orderNumber tableName waiterName grandTotal subtotal serviceCharge paymentType paymentSplit paidAt items shiftId')
      .sort({ paidAt: -1 })
      .lean();

    // Har bir payment uchun qo'shimcha ma'lumotlar
    const formattedPayments = payments.map((order, index) => ({
      _id: order._id,
      orderNumber: order.orderNumber,
      tableName: order.tableName || '-',
      waiterName: order.waiterName || 'Noma\'lum',
      totalPrice: order.grandTotal || 0,
      subtotal: order.subtotal || 0,
      serviceCharge: order.serviceCharge || 0,
      paymentType: order.paymentType,
      paymentSplit: order.paymentSplit,
      paidAt: order.paidAt,
      itemsCount: (order.items || []).filter(i => !i.isDeleted && i.status !== 'cancelled').length
    }));

    res.json({
      success: true,
      data: {
        payments: formattedPayments,
        total: formattedPayments.length
      }
    });

  } catch (error) {
    console.error('To\'lovlar ro\'yxati xatosi:', error);
    next(error);
  }
};

/**
 * KUNLIK HISOBOT TARIXI
 * GET /api/hisobot/daily-history
 */
exports.getDailyHistory = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { days = 30 } = req.query;

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));

    const dailyStats = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          isPaid: true,
          status: { $ne: 'cancelled' },
          paidAt: { $gte: startDate, $lte: endDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$paidAt',
              timezone: '+05:00' // Toshkent
            }
          },
          totalRevenue: { $sum: '$grandTotal' },
          totalOrders: { $sum: 1 },
          avgCheck: { $avg: '$grandTotal' },
          cashTotal: {
            $sum: {
              $cond: [{ $eq: ['$paymentType', 'cash'] }, '$grandTotal', 0]
            }
          },
          cardTotal: {
            $sum: {
              $cond: [{ $eq: ['$paymentType', 'card'] }, '$grandTotal', 0]
            }
          }
        }
      },
      { $sort: { _id: -1 } }
    ]);

    // Kunlik ma'lumotlarga 5% ish haqi qo'shish
    const dailyHistory = dailyStats.map(day => ({
      date: day._id,
      totalRevenue: day.totalRevenue,
      totalOrders: day.totalOrders,
      averageCheck: Math.round(day.avgCheck || 0),
      cashTotal: day.cashTotal,
      cardTotal: day.cardTotal,
      waiterSalary: Math.round(day.totalRevenue * 0.05),
      netProfit: Math.round(day.totalRevenue * 0.95)
    }));

    res.json({
      success: true,
      data: {
        history: dailyHistory,
        totalDays: dailyHistory.length
      }
    });

  } catch (error) {
    console.error('Kunlik tarix xatosi:', error);
    next(error);
  }
};
