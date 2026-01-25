const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { MONGODB_URI } = require('../config/env');

async function fixAdminUser() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected successfully');

    const db = mongoose.connection.db;

    // Find the user
    const phone = '+998905769696';
    const user = await db.collection('staffs').findOne({ phone });

    if (!user) {
      console.log('User not found with phone:', phone);

      // Find all admin users
      const admins = await db.collection('staffs').find({ role: 'admin' }).toArray();
      console.log('Found admins:', admins.map(a => ({ phone: a.phone, firstName: a.firstName, isDeleted: a.isDeleted })));

      process.exit(1);
    }

    console.log('Found user:', {
      _id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      status: user.status,
      isDeleted: user.isDeleted,
      hasPassword: !!user.password,
      passwordLength: user.password?.length
    });

    // Update user to ensure isDeleted is false
    const result = await db.collection('staffs').updateOne(
      { _id: user._id },
      {
        $set: {
          isDeleted: false,
          status: 'working'
        }
      }
    );

    console.log('Update result:', result);

    // Verify password comparison
    const password = '123456';
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Password matches:', isMatch);

    if (!isMatch) {
      console.log('Password does not match. Re-hashing password...');
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);

      await db.collection('staffs').updateOne(
        { _id: user._id },
        { $set: { password: hashedPassword } }
      );

      console.log('Password updated successfully');
    }

    // Verify the user again
    const updatedUser = await db.collection('staffs').findOne({ _id: user._id });
    console.log('Updated user:', {
      isDeleted: updatedUser.isDeleted,
      status: updatedUser.status
    });

    // Verify password again
    const finalMatch = await bcrypt.compare(password, updatedUser.password);
    console.log('Final password check:', finalMatch);

    console.log('Done!');
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

fixAdminUser();
