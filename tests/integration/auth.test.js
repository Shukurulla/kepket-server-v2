const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../../src/app');
const { Staff, Restaurant } = require('../../src/models');

// Skip if no test database
const SKIP_INTEGRATION = !process.env.TEST_MONGODB_URI;

describe('Auth API', () => {
  let testRestaurant;
  let testStaff;

  beforeAll(async () => {
    if (SKIP_INTEGRATION) {
      console.log('Skipping integration tests - no TEST_MONGODB_URI');
      return;
    }

    await mongoose.connect(process.env.TEST_MONGODB_URI);

    // Create test restaurant
    testRestaurant = await Restaurant.create({
      name: 'Test Restaurant',
      slug: 'test-restaurant'
    });

    // Create test staff
    testStaff = await Staff.create({
      restaurantId: testRestaurant._id,
      firstName: 'Test',
      lastName: 'User',
      phone: '+998901234567',
      password: 'test123',
      role: 'waiter'
    });
  });

  afterAll(async () => {
    if (SKIP_INTEGRATION) return;

    // Cleanup
    await Staff.deleteMany({ restaurantId: testRestaurant._id });
    await Restaurant.findByIdAndDelete(testRestaurant._id);
    await mongoose.connection.close();
  });

  describe('POST /api/auth/login', () => {
    it('should return 400 if phone is missing', async () => {
      if (SKIP_INTEGRATION) return;

      const res = await request(app)
        .post('/api/auth/login')
        .send({ password: 'test123' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 400 if password is missing', async () => {
      if (SKIP_INTEGRATION) return;

      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: '+998901234567' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for invalid credentials', async () => {
      if (SKIP_INTEGRATION) return;

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+998901234567',
          password: 'wrongpassword'
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return token for valid credentials', async () => {
      if (SKIP_INTEGRATION) return;

      const res = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+998901234567',
          password: 'test123'
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.token).toBeDefined();
      expect(res.body.data.staff).toBeDefined();
      expect(res.body.data.restaurant).toBeDefined();
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return 401 without token', async () => {
      if (SKIP_INTEGRATION) return;

      const res = await request(app)
        .get('/api/auth/me');

      expect(res.status).toBe(401);
    });

    it('should return user info with valid token', async () => {
      if (SKIP_INTEGRATION) return;

      // First login
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          phone: '+998901234567',
          password: 'test123'
        });

      const token = loginRes.body.data.token;

      // Then get me
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.phone).toBe('+998901234567');
    });
  });
});
