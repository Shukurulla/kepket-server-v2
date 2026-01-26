/**
 * Barcha orderlarni o'chirish scripti
 * Ishlatish: node src/scripts/clearOrders.js
 */

const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config/env');

async function clearAllOrders() {
  try {
    console.log('MongoDB ga ulanmoqda...');
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB ga ulandi!');

    // Orders collectionni to'g'ridan-to'g'ri olish
    const db = mongoose.connection.db;

    // Orderlar sonini ko'rsatish
    const orderCount = await db.collection('orders').countDocuments();
    console.log(`Jami orderlar soni: ${orderCount}`);

    if (orderCount === 0) {
      console.log('O\'chiriladigan order yo\'q.');
      await mongoose.disconnect();
      return;
    }

    // Barcha orderlarni o'chirish
    const result = await db.collection('orders').deleteMany({});
    console.log(`${result.deletedCount} ta order o'chirildi!`);

    // Stollarni ham tozalash (activeOrderId ni null qilish)
    const tableResult = await db.collection('tables').updateMany(
      { activeOrderId: { $ne: null } },
      { $set: { status: 'free', activeOrderId: null } }
    );
    console.log(`${tableResult.modifiedCount} ta stol bo'shatildi.`);

    await mongoose.disconnect();
    console.log('Tugadi!');
  } catch (error) {
    console.error('Xatolik:', error);
    process.exit(1);
  }
}

clearAllOrders();
