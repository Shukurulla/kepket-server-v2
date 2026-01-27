/**
 * Noto'g'ri konvertatsiya qilingan so'zlarni tuzatish
 * "СҲ" -> "Ш" yoki "Ч" ga o'zgartirish
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket_v2?authSource=admin';

// Noto'g'ri -> To'g'ri mapping
const fixes = [
  // Qolgan noto'g'ri so'zlar
  ["ГОРЯСҲИЕ", "ГОРЯЧИЕ"],
  ["ЧЕРНИЙ", "ЧЕРНЫЙ"],
  ["ФАРСҲ", "ФАРШ"],
  ["СИРНИЙ", "СЫРНЫЙ"],
  ["НАПОЛЕОН БЕЗ ФАРШ", "НАПОЛЕОН БЕЗ ФАРША"],

  // SH noto'g'ri konvertatsiya qilingan
  ["СҲАСҲЛИК", "ШАШЛИК"],
  ["СҲАУРМА", "ШАУРМА"],
  ["СҲОКОЛАД", "ШОКОЛАД"],
  ["СҲИРАКСҲИ", "ШИРАКШИ"],
  ["СҲИЗКЕЖК", "ЧИЗКЕЙК"],
  ["СҲАЙ", "ЧАЙ"],
  ["СҲЕРНИЙ", "ЧЕРНИЙ"],
  ["СҲОРТОҚ", "ЧОРТОҚ"],

  // Boshqa noto'g'ri
  ["АСҲСҲИК", "АЧЧИК"],
  ["СҲУСҲУК", "ЧУЧУК"],
  ["ЛАВАСҲ", "ЛАВАШ"],
  ["ОБИСҲНИЙ", "ОБЫЧНЫЙ"],
  ["ГРЕСҲЕСКИЙ", "ГРЕЧЕСКИЙ"],
  ["ГРЕСҲКА", "ГРЕЧКА"],
  ["СЕМЕСҲКИ", "СЕМЕЧКИ"],
  ["БЕСҲ", "БЕШ"],
  ["БИФСҲТЕКС", "БИФШТЕКС"],
  ["БОЛСҲОЙ", "БОЛЬШОЙ"],
  ["ГОСҲ", "ГЎШ"],
  ["ОВОСҲНОЙ", "ОВОЩНОЙ"],
  ["КИСҲИ", "КИШИ"],
  ["КИСҲКЕНЕ", "КИШКЕНЕ"],
  ["ФЛЕСҲ", "ФЛЕШ"],

  // Kichik harflar uchun ham
  ["сҳасҳлик", "шашлик"],
  ["сҳаурма", "шаурма"],
  ["сҳоколад", "шоколад"],
  ["сҳай", "чай"],

  // Umumiy patterns
  ["СҲТ", "ШТ"],  // SHT -> ШТ (BEDANA 3 SHT)
  ["сҳт", "шт"],

  // Y harfi muammolari
  ["ГОРЙА", "ГОРЯ"],
  ["БЛЙУДА", "БЛЮДА"],
  ["ГОВЙА", "ГОВЯ"],
  ["КРИЛЙЕВ", "КРЫЛЬЕВ"],
  ["ОЛИВЙЕ", "ОЛИВЬЕ"],
  ["ГАРНИРЙ", "ГАРНИРЫ"],
  ["МАНТЙ", "МАНТЫ"],
  ["КИТАЙСКИЙ", "КИТАЙСКИЙ"],
  ["САЛАТЙ", "САЛАТЫ"],
  ["ПЕРВЙЕ", "ПЕРВЫЕ"],
  ["ВТОРЙЕ", "ВТОРЫЕ"],
  ["КОНЙАК", "КОНЬЯК"],
  ["МЙАСО", "МЯСО"],
  ["ПЙУРЕ", "ПЮРЕ"],
  ["КАЗИЛЙ", "КАЗИЛИ"],
  ["ФИЛЙЕ", "ФИЛЕ"],
  ["ЖАРЕНИЙ", "ЖАРЕНЫЙ"],
  ["ЙАЙТСО", "ЯЙЦО"],
  ["СОЛЕННИЙ", "СОЛЕНЫЙ"],
  ["СОЛЕНИЙ", "СОЛЕНЫЙ"],
  ["ЗЕЛЕНИЙ", "ЗЕЛЕНЫЙ"],
  ["ФИРМЕННИЙ", "ФИРМЕННЫЙ"],
  ["СЕБАСТИЙАН", "СЕБАСТЬЯН"],
  ["ГОВЙАЖИЙ", "ГОВЯЖИЙ"],
  ["ЖАРЕННИЙ", "ЖАРЕНЫЙ"],

  // Tushunarli o'zbek so'zlari
  ["ФРУСТОВИЙ", "ФРУКТОВИЙ"],
  ["УСЛУГИ", "ХИЗМАТЛАР"],
];

function applyFixes(text) {
  if (!text || typeof text !== 'string') return text;

  let result = text;
  for (const [wrong, correct] of fixes) {
    if (result.includes(wrong)) {
      result = result.split(wrong).join(correct);
    }
  }
  return result;
}

async function fixData() {
  try {
    console.log('MongoDB ga ulanmoqda...');
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB ga ulandi!\n');

    const db = mongoose.connection.db;

    // 1. Kategoriyalarni tuzatish
    console.log('=== KATEGORIYALAR ===\n');
    const categories = await db.collection('categories').find({}).toArray();

    let categoryFixed = 0;
    for (const category of categories) {
      const oldTitle = category.title;
      const newTitle = applyFixes(oldTitle);

      if (oldTitle !== newTitle) {
        await db.collection('categories').updateOne(
          { _id: category._id },
          { $set: { title: newTitle } }
        );
        console.log(`✓ "${oldTitle}" -> "${newTitle}"`);
        categoryFixed++;
      }
    }
    console.log(`\n${categoryFixed} ta kategoriya tuzatildi\n`);

    // 2. Ovqatlarni tuzatish
    console.log('=== OVQATLAR ===\n');
    const foods = await db.collection('foods').find({}).toArray();

    let foodFixed = 0;
    for (const food of foods) {
      const oldName = food.foodName;
      const newName = applyFixes(oldName);

      const updates = {};

      if (oldName !== newName) {
        updates.foodName = newName;
      }

      if (food.description) {
        const newDesc = applyFixes(food.description);
        if (food.description !== newDesc) {
          updates.description = newDesc;
        }
      }

      if (Object.keys(updates).length > 0) {
        await db.collection('foods').updateOne(
          { _id: food._id },
          { $set: updates }
        );
        console.log(`✓ "${oldName}" -> "${updates.foodName || oldName}"`);
        foodFixed++;
      }
    }
    console.log(`\n${foodFixed} ta ovqat tuzatildi\n`);

    console.log('=== YAKUNLANDI ===');
    console.log(`Kategoriyalar: ${categoryFixed} ta tuzatildi`);
    console.log(`Ovqatlar: ${foodFixed} ta tuzatildi`);

  } catch (error) {
    console.error('Xatolik:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nMongoDB dan uzildi');
  }
}

fixData();
