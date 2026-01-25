/**
 * Migration Script - Eski bazadan yangi bazaga ma'lumotlarni ko'chirish
 *
 * Ishga tushirish:
 * node src/scripts/migrate.js
 *
 * Parametrlar:
 * --dry-run    : Faqat tekshirish, yozmaslik
 * --collection : Faqat bitta kolleksiyani migratsiya qilish (masalan: --collection=staff)
 * --skip-orders: Buyurtmalarni o'tkazib yuborish
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Environment config
require('dotenv').config();

// Connection URIs
const OLD_DB_URI = process.env.OLD_MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket?authSource=admin';
const NEW_DB_URI = process.env.MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket_v2?authSource=admin';

// Command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_ORDERS = args.includes('--skip-orders');
const SPECIFIC_COLLECTION = args.find(a => a.startsWith('--collection='))?.split('=')[1];

// Colors for console
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSuccess(message) { log(`✓ ${message}`, 'green'); }
function logWarning(message) { log(`⚠ ${message}`, 'yellow'); }
function logError(message) { log(`✗ ${message}`, 'red'); }
function logInfo(message) { log(`ℹ ${message}`, 'cyan'); }
function logSection(message) { log(`\n━━━ ${message} ━━━`, 'magenta'); }

// Statistics
const stats = {
  restaurants: { found: 0, migrated: 0, skipped: 0, errors: 0 },
  staff: { found: 0, migrated: 0, skipped: 0, errors: 0 },
  categories: { found: 0, migrated: 0, skipped: 0, errors: 0 },
  foods: { found: 0, migrated: 0, skipped: 0, errors: 0 },
  tables: { found: 0, migrated: 0, skipped: 0, errors: 0 },
  orders: { found: 0, migrated: 0, skipped: 0, errors: 0 }
};

async function connectDatabases() {
  logSection('Ma\'lumotlar bazalariga ulanish');

  // Create connections
  const oldConnection = await mongoose.createConnection(OLD_DB_URI).asPromise();
  logSuccess(`Eski bazaga ulandi: kepket`);

  const newConnection = await mongoose.createConnection(NEW_DB_URI).asPromise();
  logSuccess(`Yangi bazaga ulandi: kepket_v2`);

  // Get native db objects
  const oldDb = oldConnection.db;
  const newDb = newConnection.db;

  return { oldDb, newDb, oldConnection, newConnection };
}

// ==================== RESTAURANTS ====================
async function migrateRestaurants(oldDb, newDb) {
  if (SPECIFIC_COLLECTION && SPECIFIC_COLLECTION !== 'restaurants') return;

  logSection('Restoranlarni migratsiya qilish');

  const oldCollection = oldDb.collection('restaurants');
  const newCollection = newDb.collection('restaurants');

  const oldDocs = await oldCollection.find({}).toArray();
  stats.restaurants.found = oldDocs.length;
  logInfo(`Topildi: ${oldDocs.length} ta restoran`);

  for (const doc of oldDocs) {
    try {
      // Check if already exists
      const existing = await newCollection.findOne({ _id: doc._id });
      if (existing) {
        stats.restaurants.skipped++;
        continue;
      }

      // Transform to new schema
      const newDoc = {
        _id: doc._id,
        name: doc.name || doc.title || 'Noma\'lum restoran',
        slug: doc.slug || (doc.name || 'restoran').toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        address: doc.address || '',
        phone: doc.phone || '',
        email: doc.email || '',
        logo: doc.logo || doc.image || '',
        subscription: {
          status: doc.isActive !== false ? 'active' : 'blocked',
          expiresAt: doc.subscriptionEndDate || doc.expiresAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          plan: doc.subscriptionPlan || doc.plan || 'basic'
        },
        settings: {
          serviceChargePercent: doc.serviceChargePercent || doc.serviceFee || 10,
          currency: doc.currency || 'UZS',
          timezone: 'Asia/Tashkent',
          autoApproveOrders: doc.autoApproveOrders || false,
          requireWaiterApproval: doc.requireWaiterApproval !== false
        },
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date()
      };

      if (!DRY_RUN) {
        await newCollection.insertOne(newDoc);
      }
      stats.restaurants.migrated++;

    } catch (error) {
      stats.restaurants.errors++;
      logError(`Restoran migratsiya xatosi (${doc._id}): ${error.message}`);
    }
  }

  logSuccess(`Restoranlar: ${stats.restaurants.migrated} migratsiya qilindi, ${stats.restaurants.skipped} o'tkazib yuborildi`);
}

// ==================== STAFF ====================
async function migrateStaff(oldDb, newDb) {
  if (SPECIFIC_COLLECTION && SPECIFIC_COLLECTION !== 'staff') return;

  logSection('Xodimlarni migratsiya qilish');

  // Try different collection names
  let oldDocs = [];
  const possibleCollections = ['staff', 'staffs', 'users', 'employees'];

  for (const collName of possibleCollections) {
    try {
      const coll = oldDb.collection(collName);
      const docs = await coll.find({}).toArray();
      if (docs.length > 0) {
        oldDocs = docs;
        logInfo(`'${collName}' kolleksiyasidan foydalanilmoqda`);
        break;
      }
    } catch (e) {
      // Collection doesn't exist, continue
    }
  }

  const newCollection = newDb.collection('staffs');

  stats.staff.found = oldDocs.length;
  logInfo(`Topildi: ${oldDocs.length} ta xodim`);

  for (const doc of oldDocs) {
    try {
      // Check if already exists by phone
      const existing = await newCollection.findOne({
        $or: [{ _id: doc._id }, { phone: doc.phone }]
      });
      if (existing) {
        stats.staff.skipped++;
        continue;
      }

      // Parse name if only fullName exists
      let firstName = doc.firstName || doc.name?.split(' ')[0] || 'Ism';
      let lastName = doc.lastName || doc.name?.split(' ').slice(1).join(' ') || 'Familiya';

      // Map role
      let role = doc.role || 'waiter';
      if (role === 'manager' || role === 'owner') role = 'admin';
      if (!['admin', 'waiter', 'cook', 'cashier'].includes(role)) role = 'waiter';

      // Handle password - if plain text, hash it
      let password = doc.password;
      if (password && !password.startsWith('$2')) {
        // Plain text password - hash it
        const salt = await bcrypt.genSalt(10);
        password = await bcrypt.hash(password, salt);
      }
      if (!password) {
        // Default password: 1234
        const salt = await bcrypt.genSalt(10);
        password = await bcrypt.hash('1234', salt);
      }

      const newDoc = {
        _id: doc._id,
        restaurantId: doc.restaurantId || doc.restaurant_id || doc.restaurantID,
        firstName,
        lastName,
        phone: doc.phone || doc.phoneNumber || '',
        password,
        avatar: doc.avatar || doc.image || doc.photo || '',
        role,
        status: doc.status === 'fired' ? 'fired' : 'working',
        isWorking: doc.isWorking || doc.isOnline || false,
        isOnline: false,
        assignedCategories: doc.assignedCategories || doc.categories || [],
        autoReady: doc.autoReady || false,
        assignedTables: doc.assignedTables || doc.tables || [],
        salaryPercent: doc.salaryPercent || doc.salary || 0,
        doubleConfirmation: doc.doubleConfirmation || false,
        fcmToken: doc.fcmToken || doc.deviceToken || '',
        stats: {
          totalOrders: doc.totalOrders || 0,
          totalRevenue: doc.totalRevenue || 0,
          todayOrders: 0,
          todayRevenue: 0
        },
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date()
      };

      if (!DRY_RUN) {
        await newCollection.insertOne(newDoc);
      }
      stats.staff.migrated++;

    } catch (error) {
      stats.staff.errors++;
      logError(`Xodim migratsiya xatosi (${doc._id}): ${error.message}`);
    }
  }

  logSuccess(`Xodimlar: ${stats.staff.migrated} migratsiya qilindi, ${stats.staff.skipped} o'tkazib yuborildi`);
}

// ==================== CATEGORIES ====================
async function migrateCategories(oldDb, newDb) {
  if (SPECIFIC_COLLECTION && SPECIFIC_COLLECTION !== 'categories') return;

  logSection('Kategoriyalarni migratsiya qilish');

  let oldDocs = [];
  const possibleCollections = ['categories', 'category', 'menucategories'];

  for (const collName of possibleCollections) {
    try {
      const coll = oldDb.collection(collName);
      const docs = await coll.find({}).toArray();
      if (docs.length > 0) {
        oldDocs = docs;
        logInfo(`'${collName}' kolleksiyasidan foydalanilmoqda`);
        break;
      }
    } catch (e) {}
  }

  const newCollection = newDb.collection('categories');

  stats.categories.found = oldDocs.length;
  logInfo(`Topildi: ${oldDocs.length} ta kategoriya`);

  for (const doc of oldDocs) {
    try {
      const existing = await newCollection.findOne({ _id: doc._id });
      if (existing) {
        stats.categories.skipped++;
        continue;
      }

      const title = doc.title || doc.name || doc.categoryName || 'Kategoriya';

      const newDoc = {
        _id: doc._id,
        restaurantId: doc.restaurantId || doc.restaurant_id,
        title,
        slug: doc.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        image: doc.image || doc.icon || '',
        description: doc.description || '',
        sortOrder: doc.sortOrder || doc.order || doc.position || 0,
        isActive: doc.isActive !== false && doc.active !== false,
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date()
      };

      if (!DRY_RUN) {
        await newCollection.insertOne(newDoc);
      }
      stats.categories.migrated++;

    } catch (error) {
      stats.categories.errors++;
      logError(`Kategoriya migratsiya xatosi (${doc._id}): ${error.message}`);
    }
  }

  logSuccess(`Kategoriyalar: ${stats.categories.migrated} migratsiya qilindi, ${stats.categories.skipped} o'tkazib yuborildi`);
}

// ==================== FOODS ====================
async function migrateFoods(oldDb, newDb) {
  if (SPECIFIC_COLLECTION && SPECIFIC_COLLECTION !== 'foods') return;

  logSection('Taomlarni migratsiya qilish');

  let oldDocs = [];
  const possibleCollections = ['foods', 'food', 'menu', 'menuitems', 'products'];

  for (const collName of possibleCollections) {
    try {
      const coll = oldDb.collection(collName);
      const docs = await coll.find({}).toArray();
      if (docs.length > 0) {
        oldDocs = docs;
        logInfo(`'${collName}' kolleksiyasidan foydalanilmoqda`);
        break;
      }
    } catch (e) {}
  }

  const newCollection = newDb.collection('foods');

  stats.foods.found = oldDocs.length;
  logInfo(`Topildi: ${oldDocs.length} ta taom`);

  for (const doc of oldDocs) {
    try {
      const existing = await newCollection.findOne({ _id: doc._id });
      if (existing) {
        stats.foods.skipped++;
        continue;
      }

      const newDoc = {
        _id: doc._id,
        restaurantId: doc.restaurantId || doc.restaurant_id,
        categoryId: doc.categoryId || doc.category_id || doc.category,
        foodName: doc.foodName || doc.name || doc.title || 'Taom',
        price: doc.price || doc.cost || 0,
        description: doc.description || '',
        image: doc.image || doc.photo || doc.img || '',
        isAvailable: doc.isAvailable !== false && doc.available !== false && doc.inStock !== false,
        preparationTime: doc.preparationTime || doc.cookTime || null,
        nutrition: doc.nutrition || null,
        tags: doc.tags || [],
        orderCount: doc.orderCount || doc.orders || 0,
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date()
      };

      if (!DRY_RUN) {
        await newCollection.insertOne(newDoc);
      }
      stats.foods.migrated++;

    } catch (error) {
      stats.foods.errors++;
      logError(`Taom migratsiya xatosi (${doc._id}): ${error.message}`);
    }
  }

  logSuccess(`Taomlar: ${stats.foods.migrated} migratsiya qilindi, ${stats.foods.skipped} o'tkazib yuborildi`);
}

// ==================== TABLES ====================
async function migrateTables(oldDb, newDb) {
  if (SPECIFIC_COLLECTION && SPECIFIC_COLLECTION !== 'tables') return;

  logSection('Stollarni migratsiya qilish');

  let oldDocs = [];
  const possibleCollections = ['tables', 'table'];

  for (const collName of possibleCollections) {
    try {
      const coll = oldDb.collection(collName);
      const docs = await coll.find({}).toArray();
      if (docs.length > 0) {
        oldDocs = docs;
        logInfo(`'${collName}' kolleksiyasidan foydalanilmoqda`);
        break;
      }
    } catch (e) {}
  }

  const newCollection = newDb.collection('tables');

  stats.tables.found = oldDocs.length;
  logInfo(`Topildi: ${oldDocs.length} ta stol`);

  for (const doc of oldDocs) {
    try {
      const existing = await newCollection.findOne({ _id: doc._id });
      if (existing) {
        stats.tables.skipped++;
        continue;
      }

      // Map status
      let status = doc.status || 'free';
      if (!['free', 'occupied', 'reserved'].includes(status)) {
        status = doc.isOccupied || doc.isBusy ? 'occupied' : 'free';
      }

      const tableNumber = doc.tableNumber || doc.number || doc.tableNo || 1;

      const newDoc = {
        _id: doc._id,
        restaurantId: doc.restaurantId || doc.restaurant_id,
        title: doc.title || doc.name || `Stol ${tableNumber}`,
        tableNumber,
        status,
        assignedWaiterId: doc.assignedWaiterId || doc.waiterId || doc.waiter || null,
        capacity: doc.capacity || doc.seats || 4,
        location: doc.location || doc.zone || 'indoor',
        surcharge: doc.surcharge || 0,
        hasHourlyCharge: doc.hasHourlyCharge || doc.hourlyCharge || false,
        hourlyChargeAmount: doc.hourlyChargeAmount || doc.hourlyRate || 0,
        qrCode: doc.qrCode || doc.qr || '',
        activeOrderId: doc.activeOrderId || doc.currentOrder || null,
        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date()
      };

      if (!DRY_RUN) {
        await newCollection.insertOne(newDoc);
      }
      stats.tables.migrated++;

    } catch (error) {
      stats.tables.errors++;
      logError(`Stol migratsiya xatosi (${doc._id}): ${error.message}`);
    }
  }

  logSuccess(`Stollar: ${stats.tables.migrated} migratsiya qilindi, ${stats.tables.skipped} o'tkazib yuborildi`);
}

// ==================== ORDERS ====================
async function migrateOrders(oldDb, newDb) {
  if (SKIP_ORDERS) {
    logWarning('Buyurtmalar o\'tkazib yuborildi (--skip-orders)');
    return;
  }
  if (SPECIFIC_COLLECTION && SPECIFIC_COLLECTION !== 'orders') return;

  logSection('Buyurtmalarni migratsiya qilish');

  const oldCollection = oldDb.collection('orders');
  const newCollection = newDb.collection('orders');

  const oldDocs = await oldCollection.find({}).toArray();
  stats.orders.found = oldDocs.length;
  logInfo(`Topildi: ${oldDocs.length} ta buyurtma`);

  for (const doc of oldDocs) {
    try {
      const existing = await newCollection.findOne({ _id: doc._id });
      if (existing) {
        stats.orders.skipped++;
        continue;
      }

      // Transform items from old format to new format
      // Old format: selectFoods/allOrders array
      // New format: items array with specific structure
      let items = [];

      const oldItems = doc.items || doc.selectFoods || doc.allOrders || doc.orderItems || [];

      for (const item of oldItems) {
        items.push({
          foodId: item.foodId || item.food || item._id,
          name: item.name || item.foodName || item.title || 'Taom',
          price: item.price || item.cost || 0,
          quantity: item.quantity || item.count || item.qty || 1,
          notes: item.notes || item.comment || '',
          kitchenStatus: item.kitchenStatus || item.status || 'pending',
          addedAt: item.addedAt || item.createdAt || doc.createdAt || new Date(),
          readyAt: item.readyAt || null,
          servedAt: item.servedAt || null
        });
      }

      // Map status
      let status = doc.status || 'active';
      if (!['pending', 'active', 'completed', 'cancelled'].includes(status)) {
        if (doc.isPaid || doc.paymentStatus === 'paid') status = 'completed';
        else if (doc.isCancelled) status = 'cancelled';
        else status = 'active';
      }

      // Map payment status
      let paymentStatus = doc.paymentStatus || 'pending';
      if (!['pending', 'paid', 'refunded'].includes(paymentStatus)) {
        paymentStatus = doc.isPaid ? 'paid' : 'pending';
      }

      const newDoc = {
        _id: doc._id,
        orderNumber: doc.orderNumber || doc.number || doc.orderNo || 0,
        restaurantId: doc.restaurantId || doc.restaurant_id,
        tableId: doc.tableId || doc.table_id || doc.table,
        waiterId: doc.waiterId || doc.waiter_id || doc.waiter,

        items,

        // Pricing
        subtotal: doc.subtotal || doc.total || doc.totalPrice || 0,
        discount: doc.discount || 0,
        discountPercent: doc.discountPercent || 0,
        serviceFee: doc.serviceFee || doc.serviceCharge || 0,
        serviceFeePercent: doc.serviceFeePercent || 10,
        total: doc.total || doc.totalPrice || doc.grandTotal || 0,
        finalTotal: doc.finalTotal || doc.grandTotal || doc.total || 0,

        // Status
        status,
        paymentStatus,
        paymentMethod: doc.paymentMethod || doc.paymentType || null,
        paidAt: doc.paidAt || (paymentStatus === 'paid' ? doc.updatedAt : null),

        // Customer order specific
        waiterApproved: doc.waiterApproved !== false,
        waiterRejected: doc.waiterRejected || false,
        rejectReason: doc.rejectReason || '',

        // Meta
        isSaboy: doc.isSaboy || doc.takeaway || false,
        notes: doc.notes || doc.comment || '',

        createdAt: doc.createdAt || new Date(),
        updatedAt: doc.updatedAt || new Date()
      };

      if (!DRY_RUN) {
        await newCollection.insertOne(newDoc);
      }
      stats.orders.migrated++;

    } catch (error) {
      stats.orders.errors++;
      logError(`Buyurtma migratsiya xatosi (${doc._id}): ${error.message}`);
    }
  }

  logSuccess(`Buyurtmalar: ${stats.orders.migrated} migratsiya qilindi, ${stats.orders.skipped} o'tkazib yuborildi`);
}

// ==================== MAIN ====================
async function main() {
  console.log('\n');
  log('╔═══════════════════════════════════════════════════════════╗', 'cyan');
  log('║                                                           ║', 'cyan');
  log('║   🔄  Migratsiya Skripti - kepket → kepket_v2            ║', 'cyan');
  log('║                                                           ║', 'cyan');
  log('╚═══════════════════════════════════════════════════════════╝', 'cyan');

  if (DRY_RUN) {
    logWarning('DRY RUN rejimi - hech narsa yozilmaydi');
  }

  if (SPECIFIC_COLLECTION) {
    logInfo(`Faqat '${SPECIFIC_COLLECTION}' kolleksiyasi migratsiya qilinadi`);
  }

  let oldDb, newDb, oldConnection, newConnection;

  try {
    // Connect to databases
    const connections = await connectDatabases();
    oldDb = connections.oldDb;
    newDb = connections.newDb;
    oldConnection = connections.oldConnection;
    newConnection = connections.newConnection;

    // Run migrations
    await migrateRestaurants(oldDb, newDb);
    await migrateStaff(oldDb, newDb);
    await migrateCategories(oldDb, newDb);
    await migrateFoods(oldDb, newDb);
    await migrateTables(oldDb, newDb);
    await migrateOrders(oldDb, newDb);

    // Print summary
    logSection('YAKUNIY NATIJALAR');
    console.log('\n');
    console.log('┌────────────────┬──────────┬────────────┬──────────┬──────────┐');
    console.log('│ Kolleksiya     │ Topildi  │ Migratsiya │ O\'tkazib │ Xatolar  │');
    console.log('├────────────────┼──────────┼────────────┼──────────┼──────────┤');

    for (const [name, stat] of Object.entries(stats)) {
      const row = `│ ${name.padEnd(14)} │ ${String(stat.found).padStart(8)} │ ${String(stat.migrated).padStart(10)} │ ${String(stat.skipped).padStart(8)} │ ${String(stat.errors).padStart(8)} │`;
      console.log(row);
    }

    console.log('└────────────────┴──────────┴────────────┴──────────┴──────────┘');
    console.log('\n');

    const totalErrors = Object.values(stats).reduce((sum, s) => sum + s.errors, 0);
    if (totalErrors > 0) {
      logWarning(`Jami ${totalErrors} ta xato yuz berdi`);
    } else {
      logSuccess('Migratsiya muvaffaqiyatli yakunlandi!');
    }

    if (DRY_RUN) {
      logWarning('\nBu DRY RUN edi. Haqiqiy migratsiya uchun --dry-run ni olib tashlang.');
    }

  } catch (error) {
    logError(`Kritik xato: ${error.message}`);
    console.error(error);
  } finally {
    // Close connections
    if (oldConnection) await oldConnection.close();
    if (newConnection) await newConnection.close();
    logInfo('Bazalar yopildi');
    process.exit(0);
  }
}

// Run
main();
