const { SuperAdmin, Restaurant, Staff, Order, Table } = require('../models');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');

// JWT secret
const JWT_SECRET = process.env.JWT_SECRET || 'super-admin-secret-key';

// Setup - birinchi super admin yaratish
exports.setup = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    // Tekshirish - allaqachon super admin bormi
    const existingAdmin = await SuperAdmin.findOne();
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Super admin allaqachon mavjud'
      });
    }

    const admin = new SuperAdmin({ username, password });
    await admin.save();

    res.status(201).json({
      success: true,
      message: 'Super admin yaratildi',
      data: admin
    });
  } catch (error) {
    next(error);
  }
};

// Login
exports.login = async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const admin = await SuperAdmin.findOne({ username });
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Username yoki parol noto\'g\'ri'
      });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Username yoki parol noto\'g\'ri'
      });
    }

    // Token yaratish
    const token = jwt.sign(
      { id: admin._id, role: 'superadmin' },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Last login yangilash
    admin.lastLogin = new Date();
    await admin.save();

    res.json({
      success: true,
      token,
      admin: admin.toJSON()
    });
  } catch (error) {
    next(error);
  }
};

// Dashboard statistikasi
exports.getDashboardStats = async (req, res, next) => {
  try {
    const totalRestaurants = await Restaurant.countDocuments();
    const activeRestaurants = await Restaurant.countDocuments({ isActive: true });
    const totalStaff = await Staff.countDocuments();
    const totalOrders = await Order.countDocuments();

    // Bugungi statistika
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const todayOrders = await Order.countDocuments({
      createdAt: { $gte: today }
    });

    const todayRevenue = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: today },
          paymentStatus: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$finalTotal' }
        }
      }
    ]);

    // Oxirgi 7 kunlik statistika
    const last7Days = new Date();
    last7Days.setDate(last7Days.getDate() - 7);

    const weeklyStats = await Order.aggregate([
      {
        $match: {
          createdAt: { $gte: last7Days },
          paymentStatus: 'paid'
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          orders: { $sum: 1 },
          revenue: { $sum: '$finalTotal' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    res.json({
      success: true,
      data: {
        totalRestaurants,
        activeRestaurants,
        totalStaff,
        totalOrders,
        todayOrders,
        todayRevenue: todayRevenue[0]?.total || 0,
        weeklyStats
      }
    });
  } catch (error) {
    next(error);
  }
};

// Restoranlar ro'yxati
exports.getRestaurants = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, search, isActive } = req.query;

    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { address: { $regex: search, $options: 'i' } }
      ];
    }
    if (isActive !== undefined) {
      filter.isActive = isActive === 'true';
    }

    const restaurants = await Restaurant.find(filter)
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Restaurant.countDocuments(filter);

    // Har bir restoran uchun qo'shimcha statistika
    const restaurantsWithStats = await Promise.all(
      restaurants.map(async (restaurant) => {
        const staffCount = await Staff.countDocuments({ restaurantId: restaurant._id });
        const tableCount = await Table.countDocuments({ restaurantId: restaurant._id });
        const todayOrders = await Order.countDocuments({
          restaurantId: restaurant._id,
          createdAt: { $gte: new Date().setHours(0, 0, 0, 0) }
        });

        return {
          ...restaurant.toObject(),
          staffCount,
          tableCount,
          todayOrders
        };
      })
    );

    res.json({
      success: true,
      data: restaurantsWithStats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
};

// Bitta restoranni olish
exports.getRestaurant = async (req, res, next) => {
  try {
    const { id } = req.params;

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restoran topilmadi'
      });
    }

    // Statistika
    const staffCount = await Staff.countDocuments({ restaurantId: id });
    const tableCount = await Table.countDocuments({ restaurantId: id });
    const totalOrders = await Order.countDocuments({ restaurantId: id });

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const todayRevenue = await Order.aggregate([
      {
        $match: {
          restaurantId: new mongoose.Types.ObjectId(id),
          createdAt: { $gte: todayStart },
          paymentStatus: 'paid'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$finalTotal' }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        ...restaurant.toObject(),
        stats: {
          staffCount,
          tableCount,
          totalOrders,
          todayRevenue: todayRevenue[0]?.total || 0
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Restoran yaratish
exports.createRestaurant = async (req, res, next) => {
  try {
    const { name, address, phone, email, subscriptionPlan, subscriptionEndDate } = req.body;

    const restaurant = new Restaurant({
      name,
      address,
      phone,
      email,
      subscriptionPlan: subscriptionPlan || 'basic',
      subscriptionEndDate: subscriptionEndDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      isActive: true
    });

    await restaurant.save();

    res.status(201).json({
      success: true,
      data: restaurant
    });
  } catch (error) {
    next(error);
  }
};

// Restoranni yangilash
exports.updateRestaurant = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const restaurant = await Restaurant.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    );

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restoran topilmadi'
      });
    }

    res.json({
      success: true,
      data: restaurant
    });
  } catch (error) {
    next(error);
  }
};

// Restoranni o'chirish
exports.deleteRestaurant = async (req, res, next) => {
  try {
    const { id } = req.params;

    const restaurant = await Restaurant.findByIdAndDelete(id);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restoran topilmadi'
      });
    }

    // Bog'liq ma'lumotlarni ham o'chirish (ixtiyoriy)
    // await Staff.deleteMany({ restaurantId: id });
    // await Table.deleteMany({ restaurantId: id });
    // ...

    res.json({
      success: true,
      message: 'Restoran o\'chirildi'
    });
  } catch (error) {
    next(error);
  }
};

// Obuna yangilash
exports.updateSubscription = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { subscriptionPlan, subscriptionEndDate, isActive } = req.body;

    const restaurant = await Restaurant.findById(id);
    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restoran topilmadi'
      });
    }

    if (subscriptionPlan) restaurant.subscriptionPlan = subscriptionPlan;
    if (subscriptionEndDate) restaurant.subscriptionEndDate = new Date(subscriptionEndDate);
    if (isActive !== undefined) restaurant.isActive = isActive;

    await restaurant.save();

    res.json({
      success: true,
      data: restaurant
    });
  } catch (error) {
    next(error);
  }
};

// Barcha xodimlar
exports.getStaff = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, restaurantId, role, search } = req.query;

    const filter = {};
    if (restaurantId) filter.restaurantId = restaurantId;
    if (role) filter.role = role;
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
      ];
    }

    const staff = await Staff.find(filter)
      .populate('restaurantId', 'name')
      .sort({ createdAt: -1 })
      .skip((parseInt(page) - 1) * parseInt(limit))
      .limit(parseInt(limit));

    const total = await Staff.countDocuments(filter);

    res.json({
      success: true,
      data: staff,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    next(error);
  }
};

// Telefon tekshirish
exports.checkPhone = async (req, res, next) => {
  try {
    const { phone } = req.params;

    const staff = await Staff.findOne({ phone }).populate('restaurantId', 'name');
    if (staff) {
      return res.json({
        success: true,
        exists: true,
        data: {
          id: staff._id,
          name: `${staff.firstName} ${staff.lastName}`,
          role: staff.role,
          restaurant: staff.restaurantId?.name
        }
      });
    }

    res.json({
      success: true,
      exists: false
    });
  } catch (error) {
    next(error);
  }
};

// Super admin auth middleware
exports.authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token talab qilinadi'
      });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'superadmin') {
      return res.status(403).json({
        success: false,
        message: 'Ruxsat berilmagan'
      });
    }

    const admin = await SuperAdmin.findById(decoded.id);
    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Admin topilmadi yoki faol emas'
      });
    }

    req.superAdmin = admin;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Yaroqsiz token'
      });
    }
    next(error);
  }
};
