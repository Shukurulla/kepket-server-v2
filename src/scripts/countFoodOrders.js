const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config/env');

const FOOD_ID = '69770866535b27cf2854f97f';

async function countFoodOrders() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB ga ulandi\n');

    const Order = require('../models/order');
    const Food = require('../models/food');

    // Taom ma'lumotlarini olish
    const food = await Food.findById(FOOD_ID);
    if (food) {
      console.log('=== TAOM MA\'LUMOTLARI ===');
      console.log(`Nomi: ${food.foodName || food.name}`);
      console.log(`Narxi: ${food.price?.toLocaleString()} so'm`);
      console.log('');
    }

    // Aggregation bilan hisoblash
    const result = await Order.aggregate([
      // O'chirilmagan orderlarni olish
      { $match: { isDeleted: { $ne: true } } },
      // Items arrayni yoyish
      { $unwind: '$items' },
      // Faqat shu foodId ga mos itemlarni olish
      {
        $match: {
          'items.foodId': new mongoose.Types.ObjectId(FOOD_ID),
          'items.isDeleted': { $ne: true }
        }
      },
      // Statistika hisoblash
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },           // Necha marta zakaz qilingan (har bir order item)
          totalQuantity: { $sum: '$items.quantity' }, // Jami quantity
          totalRevenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
          paidOrders: {
            $sum: { $cond: ['$isPaid', 1, 0] }
          },
          paidQuantity: {
            $sum: { $cond: ['$isPaid', '$items.quantity', 0] }
          },
          paidRevenue: {
            $sum: {
              $cond: ['$isPaid', { $multiply: ['$items.price', '$items.quantity'] }, 0]
            }
          }
        }
      }
    ]);

    console.log('=== ZAKAZ STATISTIKASI ===');
    if (result.length > 0) {
      const stats = result[0];
      console.log(`Jami zakaz qilingan: ${stats.totalOrders} marta`);
      console.log(`Jami quantity (porsiya): ${stats.totalQuantity} ta`);
      console.log(`Jami tushum: ${stats.totalRevenue?.toLocaleString()} so'm`);
      console.log('');
      console.log('--- To\'langan zakazlar ---');
      console.log(`To'langan zakazlar soni: ${stats.paidOrders} ta`);
      console.log(`To'langan quantity: ${stats.paidQuantity} ta`);
      console.log(`To'langan tushum: ${stats.paidRevenue?.toLocaleString()} so'm`);
    } else {
      console.log('Bu taom hali zakaz qilinmagan');
    }

    // Oxirgi 10 ta zakazni ko'rsatish
    console.log('\n=== OXIRGI 10 TA ZAKAZ ===');
    const recentOrders = await Order.aggregate([
      { $match: { isDeleted: { $ne: true } } },
      { $unwind: '$items' },
      {
        $match: {
          'items.foodId': new mongoose.Types.ObjectId(FOOD_ID),
          'items.isDeleted': { $ne: true }
        }
      },
      { $sort: { createdAt: -1 } },
      { $limit: 10 },
      {
        $project: {
          orderNumber: 1,
          tableName: 1,
          quantity: '$items.quantity',
          price: '$items.price',
          total: { $multiply: ['$items.price', '$items.quantity'] },
          status: '$items.status',
          isPaid: 1,
          createdAt: 1
        }
      }
    ]);

    recentOrders.forEach((order, index) => {
      const date = new Date(order.createdAt).toLocaleDateString('uz-UZ');
      const paid = order.isPaid ? '✅' : '⏳';
      console.log(`${index + 1}. Order #${order.orderNumber} | ${order.tableName || 'Stol'} | ${order.quantity} ta | ${order.total?.toLocaleString()} so'm | ${paid} | ${date}`);
    });

    await mongoose.disconnect();
    console.log('\nMongoDB uzildi');
  } catch (error) {
    console.error('Xatolik:', error);
    process.exit(1);
  }
}

countFoodOrders();
