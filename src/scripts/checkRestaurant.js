const mongoose = require('mongoose');
const { MONGODB_URI } = require('../config/env');

async function checkRestaurant() {
  try {
    console.log('Connecting to database...');
    await mongoose.connect(MONGODB_URI);
    console.log('Connected successfully');

    const db = mongoose.connection.db;

    // Find the admin user
    const user = await db.collection('staffs').findOne({ phone: '+998905769696' });
    console.log('User restaurantId:', user.restaurantId);

    // Find the restaurant
    const restaurant = await db.collection('restaurants').findOne({ _id: user.restaurantId });

    if (!restaurant) {
      console.log('Restaurant NOT FOUND!');

      // List all restaurants
      const restaurants = await db.collection('restaurants').find({}).toArray();
      console.log('Available restaurants:', restaurants.map(r => ({
        _id: r._id,
        name: r.name,
        isActive: r.isActive,
        isDeleted: r.isDeleted
      })));
    } else {
      console.log('Found restaurant:', {
        _id: restaurant._id,
        name: restaurant.name,
        address: restaurant.address,
        isActive: restaurant.isActive,
        isDeleted: restaurant.isDeleted
      });

      // Check if isActive needs to be set
      if (restaurant.isActive !== true) {
        console.log('Setting restaurant isActive to true...');
        await db.collection('restaurants').updateOne(
          { _id: restaurant._id },
          { $set: { isActive: true, isDeleted: false } }
        );
        console.log('Restaurant activated!');
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkRestaurant();
