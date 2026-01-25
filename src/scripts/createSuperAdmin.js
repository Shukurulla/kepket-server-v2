/**
 * Super Admin yaratish skripti
 *
 * Ishga tushirish:
 * node src/scripts/createSuperAdmin.js
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket_v2?authSource=admin';

// Super Admin schema (inline)
const superAdminSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  name: { type: String, default: 'Super Admin' },
  isActive: { type: Boolean, default: true },
  lastLogin: { type: Date }
}, { timestamps: true });

async function createSuperAdmin() {
  try {
    console.log('MongoDB ga ulanmoqda...');
    await mongoose.connect(MONGODB_URI);
    console.log('✓ MongoDB ga ulandi');

    const SuperAdmin = mongoose.model('SuperAdmin', superAdminSchema);

    // Tekshirish - allaqachon mavjudmi
    const existing = await SuperAdmin.findOne({ username: 'admin' });
    if (existing) {
      console.log('⚠ "admin" foydalanuvchi allaqachon mavjud');

      // Parolni yangilash
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);
      existing.password = hashedPassword;
      await existing.save();

      console.log('✓ Parol yangilandi: admin123');
    } else {
      // Yangi super admin yaratish
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash('admin123', salt);

      const admin = new SuperAdmin({
        username: 'admin',
        password: hashedPassword,
        name: 'Super Admin',
        isActive: true
      });

      await admin.save();
      console.log('✓ Super Admin yaratildi');
    }

    console.log('\n╔════════════════════════════════════╗');
    console.log('║  Super Admin ma\'lumotlari:         ║');
    console.log('╠════════════════════════════════════╣');
    console.log('║  Username: admin                   ║');
    console.log('║  Password: admin123                ║');
    console.log('╚════════════════════════════════════╝\n');

  } catch (error) {
    console.error('✗ Xato:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('MongoDB yopildi');
    process.exit(0);
  }
}

createSuperAdmin();
