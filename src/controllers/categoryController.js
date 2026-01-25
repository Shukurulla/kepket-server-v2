const { Category, Food } = require('../models');
const socketService = require('../services/socketService');

// Get all categories
exports.getAll = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { includeEmpty } = req.query;

    let categories = await Category.find({ restaurantId })
      .sort({ sortOrder: 1, title: 1 });

    // Optionally include food count
    if (includeEmpty === 'false') {
      const categoriesWithCount = await Promise.all(
        categories.map(async (cat) => {
          const foodCount = await Food.countDocuments({
            categoryId: cat._id,
            isAvailable: true
          });
          return { ...cat.toObject(), foodCount };
        })
      );
      categories = categoriesWithCount.filter(c => c.foodCount > 0);
    }

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    next(error);
  }
};

// Get category by ID
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const category = await Category.findOne({ _id: id, restaurantId });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Get foods in this category
    const foods = await Food.find({
      categoryId: id,
      isAvailable: true
    }).sort({ sortOrder: 1, title: 1 });

    res.json({
      success: true,
      data: {
        ...category.toObject(),
        foods
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create category
exports.create = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    // Support both 'title' and 'name' for backward compatibility
    const { title, name, description, image, order, sortOrder } = req.body;
    const categoryTitle = title || name;

    // Get max order if not provided
    let categoryOrder = order ?? sortOrder;
    if (categoryOrder === undefined) {
      const maxOrder = await Category.findOne({ restaurantId })
        .sort({ sortOrder: -1 })
        .select('sortOrder');
      categoryOrder = maxOrder ? maxOrder.sortOrder + 1 : 0;
    }

    const category = await Category.create({
      restaurantId,
      title: categoryTitle,
      description,
      image,
      sortOrder: categoryOrder
    });

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'category:created', category);

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: category
    });
  } catch (error) {
    next(error);
  }
};

// Update category
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const updates = req.body;

    delete updates.restaurantId;

    const category = await Category.findOneAndUpdate(
      { _id: id, restaurantId },
      updates,
      { new: true, runValidators: true }
    );

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'category:updated', category);

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });
  } catch (error) {
    next(error);
  }
};

// Delete category (soft delete)
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId, id: deletedBy } = req.user;

    const category = await Category.findOne({ _id: id, restaurantId });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category has foods
    const foodCount = await Food.countDocuments({ categoryId: id });
    if (foodCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${foodCount} foods. Move or delete foods first.`
      });
    }

    await category.softDelete(deletedBy);

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'category:deleted', { _id: id });

    res.json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Restore category
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const category = await Category.findOneWithDeleted({ _id: id, restaurantId });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    await category.restore();

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'category:restored', category);

    res.json({
      success: true,
      message: 'Category restored successfully',
      data: category
    });
  } catch (error) {
    next(error);
  }
};

// Reorder categories
exports.reorder = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { categoryIds } = req.body; // Array of category IDs in new order

    if (!Array.isArray(categoryIds)) {
      return res.status(400).json({
        success: false,
        message: 'categoryIds must be an array'
      });
    }

    // Update order for each category
    const updates = categoryIds.map((id, index) =>
      Category.findOneAndUpdate(
        { _id: id, restaurantId },
        { sortOrder: index }
      )
    );

    await Promise.all(updates);

    // Get updated categories
    const categories = await Category.find({ restaurantId })
      .sort({ sortOrder: 1 });

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'categories:reordered', categories);

    res.json({
      success: true,
      message: 'Categories reordered successfully',
      data: categories
    });
  } catch (error) {
    next(error);
  }
};
