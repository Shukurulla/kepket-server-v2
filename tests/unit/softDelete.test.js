const mongoose = require('mongoose');
const softDeletePlugin = require('../../src/models/plugins/softDelete');

describe('Soft Delete Plugin', () => {
  let TestModel;
  let schema;

  beforeAll(() => {
    schema = new mongoose.Schema({
      name: String,
      value: Number
    });

    schema.plugin(softDeletePlugin);

    // Prevent duplicate model error
    try {
      TestModel = mongoose.model('TestModel');
    } catch {
      TestModel = mongoose.model('TestModel', schema);
    }
  });

  describe('Schema fields', () => {
    it('should add isDeleted field with default false', () => {
      const doc = new TestModel({ name: 'test' });
      expect(doc.isDeleted).toBe(false);
    });

    it('should add deletedAt field with default null', () => {
      const doc = new TestModel({ name: 'test' });
      expect(doc.deletedAt).toBeNull();
    });

    it('should add deletedBy field with default null', () => {
      const doc = new TestModel({ name: 'test' });
      expect(doc.deletedBy).toBeNull();
    });
  });

  describe('softDelete method', () => {
    it('should set isDeleted to true', async () => {
      const doc = new TestModel({ name: 'test' });

      // Mock save
      doc.save = jest.fn().mockResolvedValue(doc);

      await doc.softDelete();

      expect(doc.isDeleted).toBe(true);
      expect(doc.deletedAt).toBeInstanceOf(Date);
    });

    it('should set deletedBy when provided', async () => {
      const doc = new TestModel({ name: 'test' });
      const deleterId = new mongoose.Types.ObjectId();

      doc.save = jest.fn().mockResolvedValue(doc);

      await doc.softDelete(deleterId);

      expect(doc.deletedBy.toString()).toBe(deleterId.toString());
    });
  });

  describe('restore method', () => {
    it('should set isDeleted to false', async () => {
      const doc = new TestModel({ name: 'test' });
      doc.isDeleted = true;
      doc.deletedAt = new Date();
      doc.deletedBy = new mongoose.Types.ObjectId();

      doc.save = jest.fn().mockResolvedValue(doc);

      await doc.restore();

      expect(doc.isDeleted).toBe(false);
      expect(doc.deletedAt).toBeNull();
      expect(doc.deletedBy).toBeNull();
    });
  });
});
