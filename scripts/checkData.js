/**
 * Ma'lumotlarni tekshirish - kategoriyalar va ovqatlar ro'yxati
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket_v2?authSource=admin';

async function checkData() {
  try {
    await mongoose.connect(MONGODB_URI);
    const db = mongoose.connection.db;

    console.log('=== KATEGORIYALAR ===\n');
    const categories = await db.collection('categories').find({}).toArray();
    categories.forEach((cat, i) => {
      console.log(`${i + 1}. ${cat.title}`);
    });

    console.log('\n=== OVQATLAR (birinchi 50 ta) ===\n');
    const foods = await db.collection('foods').find({}).limit(50).toArray();
    foods.forEach((food, i) => {
      console.log(`${i + 1}. ${food.foodName}`);
    });

  } catch (error) {
    console.error('Xatolik:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkData();
