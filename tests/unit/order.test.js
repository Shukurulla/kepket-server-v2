const mongoose = require('mongoose');

// Mock mongoose before importing models
jest.mock('mongoose', () => {
  const actualMongoose = jest.requireActual('mongoose');
  return {
    ...actualMongoose,
    connect: jest.fn().mockResolvedValue({}),
    connection: {
      on: jest.fn(),
      close: jest.fn()
    }
  };
});

describe('Order Model', () => {
  let Order;

  beforeAll(() => {
    // Import after mocking
    Order = require('../../src/models/order');
  });

  describe('Order Item Schema', () => {
    it('should have correct default values', () => {
      const orderSchema = Order.schema;
      const itemsPath = orderSchema.path('items');

      expect(itemsPath).toBeDefined();
    });
  });

  describe('recalculateTotals', () => {
    it('should calculate subtotal correctly', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000 },
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Choy', quantity: 3, price: 5000 }
        ]
      });

      order.recalculateTotals();

      expect(order.subtotal).toBe(65000); // 2*25000 + 3*5000
    });

    it('should exclude deleted items from calculation', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000, isDeleted: false },
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Choy', quantity: 3, price: 5000, isDeleted: true }
        ]
      });

      order.recalculateTotals();

      expect(order.subtotal).toBe(50000); // Only 2*25000
    });

    it('should calculate service charge correctly', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        serviceChargePercent: 10,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 1, price: 100000 }
        ]
      });

      order.recalculateTotals();

      expect(order.subtotal).toBe(100000);
      expect(order.serviceCharge).toBe(10000);
      expect(order.grandTotal).toBe(110000);
    });

    it('should set allItemsReady correctly', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000, readyQuantity: 2 },
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Choy', quantity: 3, price: 5000, readyQuantity: 3 }
        ]
      });

      order.recalculateTotals();

      expect(order.allItemsReady).toBe(true);
    });

    it('should set allItemsReady to false when items not ready', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000, readyQuantity: 1 },
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Choy', quantity: 3, price: 5000, readyQuantity: 3 }
        ]
      });

      order.recalculateTotals();

      expect(order.allItemsReady).toBe(false);
    });
  });

  describe('addItem', () => {
    it('should add new item to order', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: []
      });

      const foodId = new mongoose.Types.ObjectId();
      order.addItem({
        foodId,
        foodName: 'Osh',
        quantity: 2,
        price: 25000
      });

      expect(order.items.length).toBe(1);
      expect(order.items[0].foodName).toBe('Osh');
      expect(order.items[0].quantity).toBe(2);
    });

    it('should increase quantity if item already exists', () => {
      const foodId = new mongoose.Types.ObjectId();
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId, foodName: 'Osh', quantity: 2, price: 25000 }
        ]
      });

      order.addItem({
        foodId,
        foodName: 'Osh',
        quantity: 3,
        price: 25000
      });

      expect(order.items.length).toBe(1);
      expect(order.items[0].quantity).toBe(5);
    });
  });

  describe('removeItem', () => {
    it('should soft delete item', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000 }
        ]
      });

      const itemId = order.items[0]._id;
      order.removeItem(itemId);

      expect(order.items[0].isDeleted).toBe(true);
      expect(order.items[0].deletedAt).toBeDefined();
    });

    it('should soft delete order when all items removed', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000 }
        ]
      });

      const itemId = order.items[0]._id;
      order.removeItem(itemId);

      expect(order.isDeleted).toBe(true);
    });
  });

  describe('updateItemQuantity', () => {
    it('should update item quantity', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000 }
        ]
      });

      const itemId = order.items[0]._id;
      order.updateItemQuantity(itemId, 5);

      expect(order.items[0].quantity).toBe(5);
    });

    it('should adjust readyQuantity if greater than new quantity', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 5, price: 25000, readyQuantity: 5 }
        ]
      });

      const itemId = order.items[0]._id;
      order.updateItemQuantity(itemId, 3);

      expect(order.items[0].quantity).toBe(3);
      expect(order.items[0].readyQuantity).toBe(3);
    });
  });

  describe('Virtual properties', () => {
    it('should return activeItems correctly', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000, isDeleted: false },
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Choy', quantity: 3, price: 5000, isDeleted: true }
        ]
      });

      expect(order.activeItems.length).toBe(1);
      expect(order.activeItems[0].foodName).toBe('Osh');
    });

    it('should calculate totalItemCount correctly', () => {
      const order = new Order({
        restaurantId: new mongoose.Types.ObjectId(),
        orderNumber: 1,
        items: [
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Osh', quantity: 2, price: 25000 },
          { foodId: new mongoose.Types.ObjectId(), foodName: 'Choy', quantity: 3, price: 5000 }
        ]
      });

      expect(order.totalItemCount).toBe(5);
    });
  });
});
