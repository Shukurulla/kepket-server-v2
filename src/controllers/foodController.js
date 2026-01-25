const { Food, Category } = require('../models');
const socketService = require('../services/socketService');

// Get all foods
exports.getAll = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { categoryId, isAvailable, search } = req.query;

    const filter = { restaurantId };
    if (categoryId) filter.categoryId = categoryId;
    if (isAvailable !== undefined) filter.isAvailable = isAvailable === 'true';
    if (search) {
      filter.name = { $regex: search, $options: 'i' };
    }

    const foods = await Food.find(filter)
      .populate('categoryId', 'name')
      .sort({ order: 1, name: 1 });

    res.json({
      success: true,
      data: foods
    });
  } catch (error) {
    next(error);
  }
};

// Get food by ID
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const food = await Food.findOne({ _id: id, restaurantId })
      .populate('categoryId', 'name');

    if (!food) {
      return res.status(404).json({
        success: false,
        message: 'Food not found'
      });
    }

    res.json({
      success: true,
      data: food
    });
  } catch (error) {
    next(error);
  }
};

// Get foods by category
exports.getByCategory = async (req, res, next) => {
  try {
    const { categoryId } = req.params;
    const { restaurantId } = req.user;

    const foods = await Food.find({
      restaurantId,
      categoryId,
      isAvailable: true
    }).sort({ order: 1, name: 1 });

    res.json({
      success: true,
      data: foods
    });
  } catch (error) {
    next(error);
  }
};

// Create food
exports.create = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const {
      name,
      description,
      price,
      categoryId,
      image,
      preparationTime,
      ingredients,
      isAvailable,
      order
    } = req.body;

    // Verify category exists
    const category = await Category.findOne({ _id: categoryId, restaurantId });
    if (!category) {
      return res.status(400).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Get max order if not provided
    let foodOrder = order;
    if (foodOrder === undefined) {
      const maxOrder = await Food.findOne({ categoryId })
        .sort({ order: -1 })
        .select('order');
      foodOrder = maxOrder ? maxOrder.order + 1 : 0;
    }

    const food = await Food.create({
      restaurantId,
      categoryId,
      name,
      description,
      price,
      image,
      preparationTime,
      ingredients,
      isAvailable: isAvailable !== false,
      order: foodOrder
    });

    await food.populate('categoryId', 'name');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'food:created', food);

    res.status(201).json({
      success: true,
      message: 'Food created successfully',
      data: food
    });
  } catch (error) {
    next(error);
  }
};

// Update food
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const updates = req.body;

    delete updates.restaurantId;

    // Verify category if updating
    if (updates.categoryId) {
      const category = await Category.findOne({
        _id: updates.categoryId,
        restaurantId
      });
      if (!category) {
        return res.status(400).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    const food = await Food.findOneAndUpdate(
      { _id: id, restaurantId },
      updates,
      { new: true, runValidators: true }
    ).populate('categoryId', 'name');

    if (!food) {
      return res.status(404).json({
        success: false,
        message: 'Food not found'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'food:updated', food);

    res.json({
      success: true,
      message: 'Food updated successfully',
      data: food
    });
  } catch (error) {
    next(error);
  }
};

// Toggle availability
exports.toggleAvailability = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const food = await Food.findOne({ _id: id, restaurantId });

    if (!food) {
      return res.status(404).json({
        success: false,
        message: 'Food not found'
      });
    }

    food.isAvailable = !food.isAvailable;
    await food.save();

    await food.populate('categoryId', 'name');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'food:updated', food);

    res.json({
      success: true,
      message: `Food is now ${food.isAvailable ? 'available' : 'unavailable'}`,
      data: food
    });
  } catch (error) {
    next(error);
  }
};

// Delete food (soft delete)
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId, id: deletedBy } = req.user;

    const food = await Food.findOne({ _id: id, restaurantId });

    if (!food) {
      return res.status(404).json({
        success: false,
        message: 'Food not found'
      });
    }

    await food.softDelete(deletedBy);

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'food:deleted', { _id: id });

    res.json({
      success: true,
      message: 'Food deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Restore food
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const food = await Food.findOneWithDeleted({ _id: id, restaurantId });

    if (!food) {
      return res.status(404).json({
        success: false,
        message: 'Food not found'
      });
    }

    await food.restore();
    await food.populate('categoryId', 'name');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'food:restored', food);

    res.json({
      success: true,
      message: 'Food restored successfully',
      data: food
    });
  } catch (error) {
    next(error);
  }
};

// Bulk update availability
exports.bulkUpdateAvailability = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { foodIds, isAvailable } = req.body;

    if (!Array.isArray(foodIds)) {
      return res.status(400).json({
        success: false,
        message: 'foodIds must be an array'
      });
    }

    await Food.updateMany(
      { _id: { $in: foodIds }, restaurantId },
      { isAvailable }
    );

    const foods = await Food.find({ _id: { $in: foodIds } })
      .populate('categoryId', 'name');

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'foods:bulk-updated', foods);

    res.json({
      success: true,
      message: `${foods.length} foods updated`,
      data: foods
    });
  } catch (error) {
    next(error);
  }
};

// Reorder foods within category
exports.reorder = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { foodIds } = req.body; // Array of food IDs in new order

    if (!Array.isArray(foodIds)) {
      return res.status(400).json({
        success: false,
        message: 'foodIds must be an array'
      });
    }

    // Update order for each food
    const updates = foodIds.map((id, index) =>
      Food.findOneAndUpdate(
        { _id: id, restaurantId },
        { order: index }
      )
    );

    await Promise.all(updates);

    // Get updated foods
    const foods = await Food.find({ _id: { $in: foodIds } })
      .populate('categoryId', 'name')
      .sort({ order: 1 });

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'foods:reordered', foods);

    res.json({
      success: true,
      message: 'Foods reordered successfully',
      data: foods
    });
  } catch (error) {
    next(error);
  }
};

// Get menu (categories with foods) - for waiter app
exports.getMenu = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;

    const categories = await Category.find({ restaurantId })
      .sort({ order: 1, name: 1 });

    const menu = await Promise.all(
      categories.map(async (category) => {
        const foods = await Food.find({
          categoryId: category._id,
          isAvailable: true
        }).sort({ order: 1, name: 1 });

        return {
          _id: category._id,
          name: category.name,
          description: category.description,
          image: category.image,
          foods
        };
      })
    );

    // Filter out empty categories
    const menuWithFoods = menu.filter(cat => cat.foods.length > 0);

    res.json({
      success: true,
      data: menuWithFoods
    });
  } catch (error) {
    next(error);
  }
};
