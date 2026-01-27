/**
 * Lotin -> Kirill konvertatsiya skripti
 * Barcha category va food nomlarini kirilchaga o'tkazadi
 */

require('dotenv').config();
const mongoose = require('mongoose');

// MongoDB ulanish
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket_v2?authSource=admin';

// Lotin -> Kirill mapping (O'zbek tili uchun)
// Maxsus kombinatsiyalar - uzunroqlaridan boshlab
const multiCharMappings = [
  // 3 harfli kombinatsiyalar
  ["SHC", "ШC"], ["shc", "шc"], ["Shc", "Шc"],

  // 2 harfli kombinatsiyalar (katta, kichik, aralash)
  ["SH", "Ш"], ["Sh", "Ш"], ["sh", "ш"],
  ["CH", "Ч"], ["Ch", "Ч"], ["ch", "ч"],
  ["YO", "Ё"], ["Yo", "Ё"], ["yo", "ё"],
  ["YU", "Ю"], ["Yu", "Ю"], ["yu", "ю"],
  ["YA", "Я"], ["Ya", "Я"], ["ya", "я"],
  ["YE", "Е"], ["Ye", "Е"], ["ye", "е"],
  ["TS", "Ц"], ["Ts", "Ц"], ["ts", "ц"],
  ["NG", "НГ"], ["Ng", "Нг"], ["ng", "нг"],

  // G' va O' variantlari
  ["G'", "Ғ"], ["g'", "ғ"], ["G`", "Ғ"], ["g`", "ғ"], ["Gʻ", "Ғ"], ["gʻ", "ғ"],
  ["O'", "Ў"], ["o'", "ў"], ["O`", "Ў"], ["o`", "ў"], ["Oʻ", "Ў"], ["oʻ", "ў"],
];

// Bitta harfli mappinglar
const singleCharMappings = {
  // Katta harflar
  "A": "А", "B": "Б", "C": "С", "D": "Д", "E": "Е", "F": "Ф",
  "G": "Г", "H": "Ҳ", "I": "И", "J": "Ж", "K": "К",
  "L": "Л", "M": "М", "N": "Н", "O": "О", "P": "П",
  "Q": "Қ", "R": "Р", "S": "С", "T": "Т", "U": "У",
  "V": "В", "W": "В", "X": "Х", "Y": "Й", "Z": "З",

  // Kichik harflar
  "a": "а", "b": "б", "c": "с", "d": "д", "e": "е", "f": "ф",
  "g": "г", "h": "ҳ", "i": "и", "j": "ж", "k": "к",
  "l": "л", "m": "м", "n": "н", "o": "о", "p": "п",
  "q": "қ", "r": "р", "s": "с", "t": "т", "u": "у",
  "v": "в", "w": "в", "x": "х", "y": "й", "z": "з"
};

// Konvertatsiya funksiyasi
function latinToCyrillic(text) {
  if (!text || typeof text !== 'string') return text;

  let result = '';
  let i = 0;

  while (i < text.length) {
    let matched = false;

    // Avval multi-char mappinglarni tekshirish
    for (const [latin, cyrillic] of multiCharMappings) {
      if (text.substring(i, i + latin.length) === latin) {
        result += cyrillic;
        i += latin.length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      // Single char mapping
      const char = text[i];
      if (singleCharMappings[char]) {
        result += singleCharMappings[char];
      } else {
        result += char; // O'zgarmagan holda qoldirish
      }
      i++;
    }
  }

  return result;
}

// Asosiy funksiya
async function migrate() {
  try {
    console.log('MongoDB ga ulanmoqda...');
    await mongoose.connect(MONGODB_URI);
    console.log('MongoDB ga ulandi!\n');

    const db = mongoose.connection.db;

    // 1. Kategoriyalarni o'zgartirish
    console.log('=== KATEGORIYALAR ===\n');
    const categories = await db.collection('categories').find({}).toArray();
    console.log(`Jami ${categories.length} ta kategoriya topildi\n`);

    let categoryUpdated = 0;
    for (const category of categories) {
      const oldTitle = category.title;
      const newTitle = latinToCyrillic(oldTitle);

      if (oldTitle !== newTitle) {
        await db.collection('categories').updateOne(
          { _id: category._id },
          { $set: { title: newTitle } }
        );
        console.log(`✓ "${oldTitle}" -> "${newTitle}"`);
        categoryUpdated++;
      }
    }
    console.log(`\n${categoryUpdated} ta kategoriya yangilandi\n`);

    // 2. Ovqatlarni o'zgartirish
    console.log('=== OVQATLAR ===\n');
    const foods = await db.collection('foods').find({}).toArray();
    console.log(`Jami ${foods.length} ta ovqat topildi\n`);

    let foodUpdated = 0;
    for (const food of foods) {
      const oldName = food.foodName;
      const newName = latinToCyrillic(oldName);

      const updates = {};

      if (oldName !== newName) {
        updates.foodName = newName;
      }

      // Description ham o'zgartirilsin
      if (food.description) {
        const newDesc = latinToCyrillic(food.description);
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
        foodUpdated++;
      }
    }
    console.log(`\n${foodUpdated} ta ovqat yangilandi\n`);

    console.log('=== YAKUNLANDI ===');
    console.log(`Kategoriyalar: ${categoryUpdated} ta yangilandi`);
    console.log(`Ovqatlar: ${foodUpdated} ta yangilandi`);

  } catch (error) {
    console.error('Xatolik:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nMongoDB dan uzildi');
  }
}

// Skriptni ishga tushirish
migrate();
