const { Staff, Restaurant } = require('../models');
const { generateToken } = require('../middleware/auth');
const { asyncHandler, AppError } = require('../middleware/errorHandler');

/**
 * Login
 * POST /api/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;

  console.log('=== LOGIN ATTEMPT ===');
  console.log('Phone:', phone);

  if (!phone || !password) {
    throw new AppError('Telefon va parol kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  // Find user with password
  const user = await Staff.findByPhoneWithPassword(phone);

  console.log('User found:', user ? `${user._id} (${user.phone})` : 'NOT FOUND');

  if (!user) {
    throw new AppError('Telefon yoki parol noto\'g\'ri', 401, 'INVALID_CREDENTIALS');
  }

  if (user.isDeleted) {
    throw new AppError('Akkaunt o\'chirilgan', 401, 'ACCOUNT_DELETED');
  }

  if (user.status === 'fired') {
    throw new AppError('Akkaunt bloklangan', 401, 'ACCOUNT_BLOCKED');
  }

  // Check password
  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    throw new AppError('Telefon yoki parol noto\'g\'ri', 401, 'INVALID_CREDENTIALS');
  }

  console.log('Password matched, finding restaurant:', user.restaurantId);

  // Get restaurant (o'chirilgan restoranlarni ham tekshirish)
  let restaurant = await Restaurant.findById(user.restaurantId);

  // Agar topilmasa, o'chirilganlar orasidan qidirish
  if (!restaurant) {
    restaurant = await Restaurant.findById(user.restaurantId).setOptions({ includeDeleted: true });
    if (restaurant && restaurant.isDeleted) {
      throw new AppError('Restoran o\'chirilgan', 403, 'RESTAURANT_DELETED');
    }
  }

  console.log('Restaurant found:', restaurant ? restaurant.name : 'NOT FOUND');

  if (!restaurant) {
    console.error('Restaurant not found for ID:', user.restaurantId);
    throw new AppError('Restoran topilmadi', 404, 'RESTAURANT_NOT_FOUND');
  }

  if (!restaurant.isActive) {
    throw new AppError('Restoran obunasi faol emas', 403, 'SUBSCRIPTION_INACTIVE');
  }

  // Generate token
  const token = generateToken(user._id);

  // Update last seen
  user.lastSeenAt = new Date();
  await user.save();

  res.json({
    success: true,
    data: {
      token,
      staff: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        role: user.role,
        restaurantId: user.restaurantId,
        assignedCategories: user.assignedCategories || [],
        doubleConfirmation: user.doubleConfirmation || false,
        autoReady: user.autoReady || false
      },
      restaurant: {
        _id: restaurant._id,
        id: restaurant._id, // For backward compatibility
        name: restaurant.name,
        address: restaurant.address
      }
    }
  });
});

/**
 * Get current user
 * GET /api/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await Staff.findById(req.user.id)
    .populate('restaurantId', 'name address logo settings');

  if (!user) {
    throw new AppError('Foydalanuvchi topilmadi', 404, 'NOT_FOUND');
  }

  res.json({
    success: true,
    data: {
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        status: user.status,
        isWorking: user.isWorking,
        restaurantId: user.restaurantId._id,
        restaurant: user.restaurantId
      }
    }
  });
});

/**
 * Logout
 * POST /api/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  // Update user status
  await Staff.findByIdAndUpdate(req.user.id, {
    isOnline: false,
    socketId: null,
    lastSeenAt: new Date()
  });

  res.json({
    success: true,
    message: 'Muvaffaqiyatli chiqildi'
  });
});

/**
 * Update profile
 * PATCH /api/auth/profile
 */
const updateProfile = asyncHandler(async (req, res) => {
  const { firstName, lastName, avatar } = req.body;

  const user = await Staff.findByIdAndUpdate(
    req.user.id,
    { firstName, lastName, avatar },
    { new: true, runValidators: true }
  );

  res.json({
    success: true,
    data: { user }
  });
});

/**
 * Change password
 * POST /api/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    throw new AppError('Joriy va yangi parol kiritilishi shart', 400, 'VALIDATION_ERROR');
  }

  if (newPassword.length < 4) {
    throw new AppError('Yangi parol kamida 4 belgidan iborat bo\'lishi kerak', 400, 'VALIDATION_ERROR');
  }

  const user = await Staff.findById(req.user.id).select('+password');

  const isMatch = await user.comparePassword(currentPassword);
  if (!isMatch) {
    throw new AppError('Joriy parol noto\'g\'ri', 400, 'INVALID_PASSWORD');
  }

  user.password = newPassword;
  await user.save();

  res.json({
    success: true,
    message: 'Parol muvaffaqiyatli o\'zgartirildi'
  });
});

/**
 * Toggle working status (clock in/out)
 * POST /api/auth/toggle-working
 */
const toggleWorking = asyncHandler(async (req, res) => {
  const user = await Staff.findById(req.user.id);

  user.isWorking = !user.isWorking;
  await user.save();

  res.json({
    success: true,
    data: {
      isWorking: user.isWorking
    },
    message: user.isWorking ? 'Ish boshlandi' : 'Ish tugadi'
  });
});

module.exports = {
  login,
  getMe,
  logout,
  updateProfile,
  changePassword,
  toggleWorking
};
