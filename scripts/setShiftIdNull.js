/**
 * Barcha orderlarga shiftId: null qo'shish
 * Bu skript eski orderlarni yangi smena tizimidan ajratib qo'yadi
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/restoran';

async function setShiftIdNull() {
  try {
    console.log('MongoDB ga ulanmoqda...');
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB ga ulandi!');

    const Order = mongoose.model('Order', new mongoose.Schema({}, { strict: false }), 'orders');

    // Barcha orderlarni topish (shiftId bo'lmagan yoki mavjud)
    const result = await Order.updateMany(
      {}, // Barcha orderlar
      { $set: { shiftId: null } } // shiftId ni null qilish
    );

    console.log(`\n✅ ${result.modifiedCount} ta order yangilandi`);
    console.log(`📊 Jami ${result.matchedCount} ta order topildi`);

    // Tekshirish
    const ordersWithShiftId = await Order.countDocuments({ shiftId: { $ne: null } });
    const ordersWithoutShiftId = await Order.countDocuments({ shiftId: null });
    
    console.log(`\n📈 Statistika:`);
    console.log(`   - shiftId bor: ${ordersWithShiftId}`);
    console.log(`   - shiftId null: ${ordersWithoutShiftId}`);

    await mongoose.disconnect();
    console.log('\n✅ Tayyor!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Xatolik:', error);
    process.exit(1);
  }
}

setShiftIdNull();
