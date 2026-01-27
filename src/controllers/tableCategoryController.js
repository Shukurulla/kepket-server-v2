const { TableCategory, Table } = require('../models');
const socketService = require('../services/socketService');

// Get all table categories
exports.getAll = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { includeEmpty } = req.query;

    let categories = await TableCategory.find({
      restaurantId,
      isDeleted: { $ne: true }
    }).sort({ sortOrder: 1, title: 1 });

    // Add table count to each category
    const categoriesWithCount = await Promise.all(
      categories.map(async (cat) => {
        const tableCount = await Table.countDocuments({
          categoryId: cat._id,
          isDeleted: { $ne: true }
        });
        return { ...cat.toObject(), tableCount };
      })
    );

    // Optionally filter empty categories
    if (includeEmpty === 'false') {
      categories = categoriesWithCount.filter(c => c.tableCount > 0);
    } else {
      categories = categoriesWithCount;
    }

    res.json({
      success: true,
      data: categories
    });
  } catch (error) {
    next(error);
  }
};

// Get category by ID with tables
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const category = await TableCategory.findOne({
      _id: id,
      restaurantId,
      isDeleted: { $ne: true }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Get tables in this category
    const tables = await Table.find({
      categoryId: id,
      isDeleted: { $ne: true }
    })
      .populate('assignedWaiterId', 'firstName lastName')
      .sort({ title: 1 });

    res.json({
      success: true,
      data: {
        ...category.toObject(),
        tables
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create table category
exports.create = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { title, description, icon, sortOrder } = req.body;

    if (!title) {
      return res.status(400).json({
        success: false,
        message: 'Category title is required'
      });
    }

    // Get max order if not provided
    let categoryOrder = sortOrder;
    if (categoryOrder === undefined) {
      const maxOrder = await TableCategory.findOne({ restaurantId })
        .sort({ sortOrder: -1 })
        .select('sortOrder');
      categoryOrder = maxOrder ? maxOrder.sortOrder + 1 : 0;
    }

    const category = await TableCategory.create({
      restaurantId,
      title,
      description,
      icon: icon || 'table',
      sortOrder: categoryOrder
    });

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'tableCategory:created', category);

    res.status(201).json({
      success: true,
      message: 'Table category created successfully',
      data: category
    });
  } catch (error) {
    next(error);
  }
};

// Update table category
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const updates = req.body;

    delete updates.restaurantId;

    const category = await TableCategory.findOneAndUpdate(
      { _id: id, restaurantId, isDeleted: { $ne: true } },
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
    socketService.emitToRestaurant(restaurantId, 'tableCategory:updated', category);

    res.json({
      success: true,
      message: 'Table category updated successfully',
      data: category
    });
  } catch (error) {
    next(error);
  }
};

// Delete table category (soft delete)
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId, id: deletedBy } = req.user;

    const category = await TableCategory.findOne({
      _id: id,
      restaurantId,
      isDeleted: { $ne: true }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category has tables
    const tableCount = await Table.countDocuments({
      categoryId: id,
      isDeleted: { $ne: true }
    });

    if (tableCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category with ${tableCount} tables. Move or delete tables first.`
      });
    }

    await category.softDelete(deletedBy);

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'tableCategory:deleted', { _id: id });

    res.json({
      success: true,
      message: 'Table category deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Restore table category
exports.restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;

    const category = await TableCategory.findOneWithDeleted({ _id: id, restaurantId });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    await category.restore();

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'tableCategory:restored', category);

    res.json({
      success: true,
      message: 'Table category restored successfully',
      data: category
    });
  } catch (error) {
    next(error);
  }
};

// Reorder table categories
exports.reorder = async (req, res, next) => {
  try {
    const { restaurantId } = req.user;
    const { categoryIds } = req.body;

    if (!Array.isArray(categoryIds)) {
      return res.status(400).json({
        success: false,
        message: 'categoryIds must be an array'
      });
    }

    // Update order for each category
    const updates = categoryIds.map((id, index) =>
      TableCategory.findOneAndUpdate(
        { _id: id, restaurantId },
        { sortOrder: index }
      )
    );

    await Promise.all(updates);

    // Get updated categories
    const categories = await TableCategory.find({
      restaurantId,
      isDeleted: { $ne: true }
    }).sort({ sortOrder: 1 });

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'tableCategories:reordered', categories);

    res.json({
      success: true,
      message: 'Table categories reordered successfully',
      data: categories
    });
  } catch (error) {
    next(error);
  }
};

// Add tables to category
exports.addTables = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { restaurantId } = req.user;
    const { tableIds } = req.body;

    if (!Array.isArray(tableIds) || tableIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'tableIds must be a non-empty array'
      });
    }

    const category = await TableCategory.findOne({
      _id: id,
      restaurantId,
      isDeleted: { $ne: true }
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Update tables
    await Table.updateMany(
      { _id: { $in: tableIds }, restaurantId },
      { categoryId: id }
    );

    // Get updated tables
    const tables = await Table.find({
      categoryId: id,
      isDeleted: { $ne: true }
    })
      .populate('assignedWaiterId', 'firstName lastName')
      .sort({ title: 1 });

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'tableCategory:tablesAdded', {
      categoryId: id,
      tables
    });

    res.json({
      success: true,
      message: 'Tables added to category successfully',
      data: { category, tables }
    });
  } catch (error) {
    next(error);
  }
};

// Remove table from category
exports.removeTable = async (req, res, next) => {
  try {
    const { id, tableId } = req.params;
    const { restaurantId } = req.user;

    const table = await Table.findOneAndUpdate(
      { _id: tableId, categoryId: id, restaurantId },
      { $unset: { categoryId: 1 } },
      { new: true }
    );

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found in this category'
      });
    }

    // Emit socket event
    socketService.emitToRestaurant(restaurantId, 'tableCategory:tableRemoved', {
      categoryId: id,
      tableId
    });

    res.json({
      success: true,
      message: 'Table removed from category successfully',
      data: table
    });
  } catch (error) {
    next(error);
  }
};
