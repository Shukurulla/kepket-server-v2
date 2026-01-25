/**
 * Migration Script
 * Migrates data from old backend structure to new unified structure
 *
 * Usage: node scripts/migrate.js
 *
 * Before running:
 * 1. Set OLD_MONGODB_URI in .env for old database
 * 2. Set MONGODB_URI in .env for new database
 * 3. Backup both databases!
 */

require('dotenv').config();
const mongoose = require('mongoose');

// New models
const {
  Restaurant,
  Staff,
  Category,
  Food,
  Table,
  Order,
  Notification
} = require('../src/models');

// Old database connection
const OLD_MONGODB_URI = process.env.OLD_MONGODB_URI || process.env.MONGODB_URI;
const NEW_MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/restoran_v2';

// Old model schemas (simplified for migration)
const oldOrderSchema = new mongoose.Schema({}, { strict: false });
const oldKitchenOrderSchema = new mongoose.Schema({}, { strict: false });
const oldWaiterSchema = new mongoose.Schema({}, { strict: false });
const oldStaffSchema = new mongoose.Schema({}, { strict: false });
const oldTableSchema = new mongoose.Schema({}, { strict: false });
const oldCategorySchema = new mongoose.Schema({}, { strict: false });
const oldFoodSchema = new mongoose.Schema({}, { strict: false });
const oldRestaurantSchema = new mongoose.Schema({}, { strict: false });

let OldOrder, OldKitchenOrder, OldWaiter, OldStaff, OldTable, OldCategory, OldFood, OldRestaurant;

// Statistics
const stats = {
  restaurants: { migrated: 0, failed: 0 },
  staff: { migrated: 0, failed: 0 },
  categories: { migrated: 0, failed: 0 },
  foods: { migrated: 0, failed: 0 },
  tables: { migrated: 0, failed: 0 },
  orders: { migrated: 0, failed: 0 },
  waiters: { migrated: 0, skipped: 0 }
};

/**
 * Connect to databases
 */
async function connectDatabases() {
  console.log('Connecting to databases...');

  // Connect to old database
  const oldConn = await mongoose.createConnection(OLD_MONGODB_URI);
  console.log('Connected to old database');

  // Register old models
  OldOrder = oldConn.model('Order', oldOrderSchema, 'orders');
  OldKitchenOrder = oldConn.model('KitchenOrder', oldKitchenOrderSchema, 'kitchenorders');
  OldWaiter = oldConn.model('Waiter', oldWaiterSchema, 'waiters');
  OldStaff = oldConn.model('Staff', oldStaffSchema, 'staffs');
  OldTable = oldConn.model('Table', oldTableSchema, 'tables');
  OldCategory = oldConn.model('Category', oldCategorySchema, 'categories');
  OldFood = oldConn.model('Food', oldFoodSchema, 'foods');
  OldRestaurant = oldConn.model('Restaurant', oldRestaurantSchema, 'restaurants');

  // Connect to new database
  await mongoose.connect(NEW_MONGODB_URI);
  console.log('Connected to new database');

  return oldConn;
}

/**
 * Migrate restaurants
 */
async function migrateRestaurants() {
  console.log('\n--- Migrating Restaurants ---');

  const oldRestaurants = await OldRestaurant.find({});
  console.log(`Found ${oldRestaurants.length} restaurants`);

  for (const old of oldRestaurants) {
    try {
      const exists = await Restaurant.findById(old._id);
      if (exists) {
        console.log(`  Skipping ${old.name} - already exists`);
        continue;
      }

      const restaurant = new Restaurant({
        _id: old._id,
        name: old.name || 'Unknown',
        slug: old.slug,
        address: old.address,
        phone: old.phone,
        email: old.email,
        logo: old.logo,
        subscription: {
          status: old.subscription?.status || 'active',
          expiresAt: old.subscription?.expiresAt,
          plan: old.subscription?.plan || 'basic'
        },
        settings: {
          serviceChargePercent: old.serviceChargePercent || 10,
          currency: 'UZS'
        },
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        isDeleted: false
      });

      await restaurant.save();
      stats.restaurants.migrated++;
      console.log(`  ✓ Migrated: ${old.name}`);
    } catch (error) {
      stats.restaurants.failed++;
      console.error(`  ✗ Failed: ${old.name} - ${error.message}`);
    }
  }
}

/**
 * Migrate staff (including old Waiter model)
 */
async function migrateStaff() {
  console.log('\n--- Migrating Staff ---');

  // First, migrate from Staff model
  const oldStaffs = await OldStaff.find({});
  console.log(`Found ${oldStaffs.length} staff members`);

  for (const old of oldStaffs) {
    try {
      const exists = await Staff.findOne({ phone: old.phone });
      if (exists) {
        console.log(`  Skipping ${old.phone} - already exists`);
        continue;
      }

      const staff = new Staff({
        _id: old._id,
        restaurantId: old.restaurantId,
        firstName: old.firstName || 'Unknown',
        lastName: old.lastName || '',
        phone: old.phone,
        password: old.password,
        role: old.role || 'waiter',
        status: old.status || 'working',
        isWorking: old.isWorking || false,
        assignedCategories: old.assignedCategories || [],
        assignedTables: old.assignedTables || [],
        salaryPercent: old.salaryPercent || 0,
        autoReady: old.autoReady || false,
        doubleConfirmation: old.doubleConfirmation || false,
        fcmToken: old.fcmToken,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        isDeleted: false
      });

      await staff.save({ validateBeforeSave: false }); // Skip password hashing
      stats.staff.migrated++;
      console.log(`  ✓ Migrated: ${old.phone} (${old.role})`);
    } catch (error) {
      stats.staff.failed++;
      console.error(`  ✗ Failed: ${old.phone} - ${error.message}`);
    }
  }

  // Then, migrate from old Waiter model (if any are missing)
  console.log('\n  Checking old Waiter model...');
  const oldWaiters = await OldWaiter.find({});
  console.log(`  Found ${oldWaiters.length} waiters in old model`);

  for (const old of oldWaiters) {
    try {
      const exists = await Staff.findOne({ phone: old.phone });
      if (exists) {
        stats.waiters.skipped++;
        continue;
      }

      const staff = new Staff({
        restaurantId: old.restaurantId,
        firstName: old.firstName || 'Unknown',
        lastName: old.lastName || '',
        phone: old.phone,
        password: old.password,
        role: 'waiter',
        status: old.isActive !== false ? 'working' : 'fired',
        assignedTables: old.assignedTables || [],
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        isDeleted: false
      });

      await staff.save({ validateBeforeSave: false });
      stats.waiters.migrated++;
      console.log(`  ✓ Migrated waiter: ${old.phone}`);
    } catch (error) {
      console.error(`  ✗ Failed waiter: ${old.phone} - ${error.message}`);
    }
  }
}

/**
 * Migrate categories
 */
async function migrateCategories() {
  console.log('\n--- Migrating Categories ---');

  const oldCategories = await OldCategory.find({});
  console.log(`Found ${oldCategories.length} categories`);

  for (const old of oldCategories) {
    try {
      const exists = await Category.findById(old._id);
      if (exists) {
        continue;
      }

      const category = new Category({
        _id: old._id,
        restaurantId: old.restaurantId,
        title: old.title || old.name || 'Unknown',
        slug: old.slug,
        image: old.image,
        sortOrder: old.sortOrder || 0,
        isActive: old.isActive !== false,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        isDeleted: false
      });

      await category.save();
      stats.categories.migrated++;
    } catch (error) {
      stats.categories.failed++;
      console.error(`  ✗ Failed category: ${old.title} - ${error.message}`);
    }
  }

  console.log(`  ✓ Migrated ${stats.categories.migrated} categories`);
}

/**
 * Migrate foods
 */
async function migrateFoods() {
  console.log('\n--- Migrating Foods ---');

  const oldFoods = await OldFood.find({});
  console.log(`Found ${oldFoods.length} foods`);

  for (const old of oldFoods) {
    try {
      const exists = await Food.findById(old._id);
      if (exists) {
        continue;
      }

      const food = new Food({
        _id: old._id,
        restaurantId: old.restaurantId,
        categoryId: old.categoryId || old.category,
        foodName: old.foodName || old.name || 'Unknown',
        price: old.price || 0,
        description: old.description,
        image: old.image,
        isAvailable: old.isAvailable !== false,
        preparationTime: old.preparationTime,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        isDeleted: false
      });

      await food.save();
      stats.foods.migrated++;
    } catch (error) {
      stats.foods.failed++;
      console.error(`  ✗ Failed food: ${old.foodName} - ${error.message}`);
    }
  }

  console.log(`  ✓ Migrated ${stats.foods.migrated} foods`);
}

/**
 * Migrate tables
 */
async function migrateTables() {
  console.log('\n--- Migrating Tables ---');

  const oldTables = await OldTable.find({});
  console.log(`Found ${oldTables.length} tables`);

  for (const old of oldTables) {
    try {
      const exists = await Table.findById(old._id);
      if (exists) {
        continue;
      }

      const table = new Table({
        _id: old._id,
        restaurantId: old.restaurantId,
        title: old.title || old.name || `Table ${old.tableNumber}`,
        tableNumber: old.tableNumber || 1,
        status: old.status || 'free',
        assignedWaiterId: old.assignedWaiterId || old.waiter,
        capacity: old.capacity || 4,
        surcharge: old.surcharge || 0,
        hasHourlyCharge: old.hasHourlyCharge || false,
        hourlyChargeAmount: old.hourlyChargeAmount || 0,
        qrCode: old.qrCode,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        isDeleted: false
      });

      await table.save();
      stats.tables.migrated++;
    } catch (error) {
      stats.tables.failed++;
      console.error(`  ✗ Failed table: ${old.title} - ${error.message}`);
    }
  }

  console.log(`  ✓ Migrated ${stats.tables.migrated} tables`);
}

/**
 * Migrate orders
 */
async function migrateOrders() {
  console.log('\n--- Migrating Orders ---');

  // Get all old orders
  const oldOrders = await OldOrder.find({}).sort({ createdAt: -1 }).limit(10000);
  console.log(`Found ${oldOrders.length} orders`);

  // Get kitchen orders for additional data
  const oldKitchenOrders = await OldKitchenOrder.find({});
  const kitchenOrderMap = new Map();
  for (const ko of oldKitchenOrders) {
    if (ko.orderId) {
      kitchenOrderMap.set(ko.orderId.toString(), ko);
    }
  }

  let count = 0;
  for (const old of oldOrders) {
    try {
      const exists = await Order.findById(old._id);
      if (exists) {
        continue;
      }

      const kitchenOrder = kitchenOrderMap.get(old._id.toString());

      // Merge items from different sources
      const items = mergeOrderItems(old, kitchenOrder);

      const order = new Order({
        _id: old._id,
        restaurantId: old.restaurantId,
        orderNumber: old.orderNumber || 1,
        orderType: old.orderType || 'dine-in',
        saboyNumber: old.saboyNumber,
        tableId: old.tableId,
        tableName: old.tableName,
        tableNumber: old.tableNumber,
        items: items,
        subtotal: old.totalPrice || 0,
        serviceCharge: old.ofitsianService || 0,
        serviceChargePercent: 10,
        discount: old.discount ? (old.totalPrice * 0.1) : 0,
        surcharge: old.surcharge || 0,
        grandTotal: (old.totalPrice || 0) + (old.ofitsianService || 0) + (old.surcharge || 0),
        status: mapOrderStatus(old, kitchenOrder),
        waiterId: old.waiterId,
        waiterName: old.waiterName,
        waiterApproved: old.waiterApproved || false,
        approvedAt: old.approvedAt,
        waiterRejected: old.waiterRejected || false,
        allItemsReady: kitchenOrder?.allItemsReady || false,
        notifiedWaiter: kitchenOrder?.notifiedWaiter || false,
        isPaid: old.isPaid || false,
        paymentType: old.paymentType,
        paidAt: old.paidAt,
        source: old.fromWaiter ? 'waiter' : 'customer',
        orderedAt: old.createdAt,
        comment: old.comment,
        createdAt: old.createdAt,
        updatedAt: old.updatedAt,
        isDeleted: false
      });

      await order.save();
      stats.orders.migrated++;
      count++;

      if (count % 100 === 0) {
        console.log(`  Progress: ${count}/${oldOrders.length}`);
      }
    } catch (error) {
      stats.orders.failed++;
      if (stats.orders.failed <= 10) {
        console.error(`  ✗ Failed order: ${old._id} - ${error.message}`);
      }
    }
  }

  console.log(`  ✓ Migrated ${stats.orders.migrated} orders`);
}

/**
 * Merge order items from allOrders/selectFoods and kitchenOrder
 */
function mergeOrderItems(order, kitchenOrder) {
  // Prefer kitchenOrder items if available (more structured)
  if (kitchenOrder?.items?.length > 0) {
    return kitchenOrder.items.map((item, idx) => ({
      _id: item._id || new mongoose.Types.ObjectId(),
      foodId: item.foodId || item._id,
      foodName: item.foodName || item.name || 'Unknown',
      categoryId: item.categoryId || item.category,
      categoryName: item.categoryName,
      quantity: item.quantity || 1,
      price: item.price || 0,
      status: mapItemStatus(item),
      readyQuantity: item.readyQuantity || (item.isReady ? item.quantity : 0),
      readyAt: item.readyAt,
      addedAt: item.addedAt || order.createdAt,
      isDeleted: false
    }));
  }

  // Fall back to selectFoods
  const selectFoods = order.selectFoods || order.allOrders || [];
  return selectFoods.map((item, idx) => ({
    _id: item._id || new mongoose.Types.ObjectId(),
    foodId: item.foodId || item._id,
    foodName: item.foodName || item.name || 'Unknown',
    categoryId: item.category || item.categoryId,
    quantity: item.quantity || 1,
    price: item.price || 0,
    status: 'pending',
    readyQuantity: 0,
    addedAt: order.createdAt,
    isDeleted: false
  }));
}

/**
 * Map old order status to new
 */
function mapOrderStatus(order, kitchenOrder) {
  if (order.isPaid) return 'paid';
  if (order.status === 'cancelled') return 'cancelled';
  if (kitchenOrder?.status === 'served') return 'served';
  if (kitchenOrder?.allItemsReady) return 'ready';
  if (kitchenOrder?.status === 'preparing') return 'preparing';
  if (order.waiterApproved) return 'approved';
  return 'pending';
}

/**
 * Map item status
 */
function mapItemStatus(item) {
  if (item.status) return item.status;
  if (item.isReady) return 'ready';
  if (item.readyQuantity > 0) return 'preparing';
  return 'pending';
}

/**
 * Print migration summary
 */
function printSummary() {
  console.log('\n╔═══════════════════════════════════════════════════════════╗');
  console.log('║              MIGRATION SUMMARY                            ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log(`║  Restaurants:  ${stats.restaurants.migrated} migrated, ${stats.restaurants.failed} failed`);
  console.log(`║  Staff:        ${stats.staff.migrated} migrated, ${stats.staff.failed} failed`);
  console.log(`║  Waiters:      ${stats.waiters.migrated} migrated, ${stats.waiters.skipped} skipped`);
  console.log(`║  Categories:   ${stats.categories.migrated} migrated, ${stats.categories.failed} failed`);
  console.log(`║  Foods:        ${stats.foods.migrated} migrated, ${stats.foods.failed} failed`);
  console.log(`║  Tables:       ${stats.tables.migrated} migrated, ${stats.tables.failed} failed`);
  console.log(`║  Orders:       ${stats.orders.migrated} migrated, ${stats.orders.failed} failed`);
  console.log('╚═══════════════════════════════════════════════════════════╝');
}

/**
 * Main migration function
 */
async function main() {
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║           RESTORAN DATABASE MIGRATION v2.0                ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');

  try {
    const oldConn = await connectDatabases();

    // Run migrations in order
    await migrateRestaurants();
    await migrateStaff();
    await migrateCategories();
    await migrateFoods();
    await migrateTables();
    await migrateOrders();

    // Print summary
    printSummary();

    // Close connections
    await oldConn.close();
    await mongoose.connection.close();

    console.log('\n✓ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n✗ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
main();
