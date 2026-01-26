const { Order, Food, Staff, Table, Category } = require('../models');
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
    const { period = 'today' } = req.query;
    const { start, end } = getDateRange(period);

    // Get orders in date range
    const orders = await Order.find({
      restaurantId,
      createdAt: { $gte: start, $lte: end },
      status: { $ne: 'cancelled' }
    });

    // Calculate metrics
    const totalOrders = orders.length;
    const completedOrders = orders.filter(o => o.isPaid === true).length;
    const totalRevenue = orders
      .filter(o => o.isPaid === true)
      .reduce((sum, o) => sum + (o.grandTotal || o.subtotal || 0), 0);

    const totalItems = orders.reduce((sum, o) => sum + o.items.length, 0);

    // Get active tables
    const activeTables = await Table.countDocuments({
      restaurantId,
      status: 'occupied'
    });

    const totalTables = await Table.countDocuments({ restaurantId });

    // Get today's top foods
    const topFoods = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          createdAt: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' }
        }
      },
      { $unwind: '$items' },
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
      {
        $group: {
          _id: dateFormat,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$grandTotal' },
          totalItems: { $sum: { $size: '$items' } }
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
    const { startDate, endDate, categoryId } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    if (!startDate) {
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }
    end.setHours(23, 59, 59, 999);

    const matchStage = {
      restaurantId: new mongoose.Types.ObjectId(restaurantId),
      createdAt: { $gte: start, $lte: end },
      status: { $ne: 'cancelled' }
    };

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
    const { startDate, endDate, role } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    if (!startDate) {
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }
    end.setHours(23, 59, 59, 999);

    // Get waiter performance
    const waiterStats = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          createdAt: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: '$waiterId',
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: '$grandTotal' },
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
    const { startDate, endDate } = req.query;

    const start = startDate ? new Date(startDate) : new Date();
    const end = endDate ? new Date(endDate) : new Date();

    if (!startDate) {
      start.setDate(start.getDate() - 30);
      start.setHours(0, 0, 0, 0);
    }
    end.setHours(23, 59, 59, 999);

    const paymentStats = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          createdAt: { $gte: start, $lte: end },
          isPaid: true
        }
      },
      {
        $group: {
          _id: '$paymentType',
          count: { $sum: 1 },
          total: { $sum: '$grandTotal' }
        }
      },
      { $sort: { total: -1 } }
    ]);

    const totalRevenue = paymentStats.reduce((sum, p) => sum + p.total, 0);

    const paymentBreakdown = paymentStats.map(p => ({
      method: p._id || 'unknown',
      count: p.count,
      total: p.total,
      percentage: totalRevenue > 0 ? Math.round((p.total / totalRevenue) * 100) : 0
    }));

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
    const { date } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const start = new Date(targetDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(targetDate);
    end.setHours(23, 59, 59, 999);

    const hourlyStats = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(restaurantId),
          createdAt: { $gte: start, $lte: end },
          status: { $ne: 'cancelled' }
        }
      },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          orderCount: { $sum: 1 },
          revenue: { $sum: '$grandTotal' }
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
