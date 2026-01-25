const { Table, Restaurant } = require('../models');
const crypto = require('crypto');

// Store nonces temporarily (in production, use Redis)
const nonceStore = new Map();

// Generate nonce for QR scanning
exports.getNonce = async (req, res, next) => {
  try {
    const { tableId } = req.params;

    const table = await Table.findById(tableId).populate('restaurantId');
    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Stol topilmadi'
      });
    }

    // Generate nonce
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    nonceStore.set(nonce, {
      tableId: table._id,
      restaurantId: table.restaurantId._id,
      expiresAt
    });

    // Clean expired nonces
    setTimeout(() => nonceStore.delete(nonce), 5 * 60 * 1000);

    res.json({
      success: true,
      data: {
        nonce,
        table: {
          id: table._id,
          number: table.number,
          floor: table.floor
        },
        restaurant: {
          id: table.restaurantId._id,
          name: table.restaurantId.name
        },
        expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get nonce by table data (tableId-restaurantId format)
exports.getNonceByTableData = async (req, res, next) => {
  try {
    const { tableData } = req.params;
    const [tableId, restaurantId] = tableData.split('-');

    const table = await Table.findOne({
      _id: tableId,
      restaurantId
    }).populate('restaurantId');

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Stol topilmadi'
      });
    }

    // Generate nonce
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    nonceStore.set(nonce, {
      tableId: table._id,
      restaurantId: table.restaurantId._id,
      expiresAt
    });

    setTimeout(() => nonceStore.delete(nonce), 5 * 60 * 1000);

    res.json({
      success: true,
      data: {
        nonce,
        table: {
          id: table._id,
          number: table.number,
          floor: table.floor
        },
        restaurant: {
          id: table.restaurantId._id,
          name: table.restaurantId.name
        },
        expiresAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// Session storage (in production, use Redis)
const sessionStore = new Map();

// Create session
exports.createSession = async (req, res, next) => {
  try {
    const { nonce, tableId } = req.body;

    // Validate nonce
    const nonceData = nonceStore.get(nonce);
    if (!nonceData) {
      return res.status(400).json({
        success: false,
        message: 'Nonce yaroqsiz yoki muddati tugagan'
      });
    }

    if (new Date() > nonceData.expiresAt) {
      nonceStore.delete(nonce);
      return res.status(400).json({
        success: false,
        message: 'Nonce muddati tugagan'
      });
    }

    // Delete used nonce
    nonceStore.delete(nonce);

    // Get table and restaurant info
    const table = await Table.findById(tableId || nonceData.tableId)
      .populate('restaurantId');

    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Stol topilmadi'
      });
    }

    // Generate session token
    const sessionToken = crypto.randomBytes(64).toString('hex');
    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours

    // Store session
    sessionStore.set(sessionToken, {
      tableId: table._id,
      restaurantId: table.restaurantId._id,
      createdAt: new Date(),
      expiresAt
    });

    // Update table status
    await Table.findByIdAndUpdate(table._id, { status: 'occupied' });

    res.json({
      success: true,
      sessionToken,
      table: {
        id: table._id,
        number: table.number,
        floor: table.floor
      },
      restaurant: {
        id: table.restaurantId._id,
        name: table.restaurantId.name
      },
      tableId: table._id,
      restaurantId: table.restaurantId._id,
      expiresAt
    });
  } catch (error) {
    next(error);
  }
};

// Check session status
exports.getSessionStatus = async (req, res, next) => {
  try {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
      return res.json({ valid: false, message: 'Token topilmadi' });
    }

    const session = sessionStore.get(sessionToken);
    if (!session) {
      return res.json({ valid: false, message: 'Sessiya topilmadi' });
    }

    if (new Date() > session.expiresAt) {
      sessionStore.delete(sessionToken);
      return res.json({ valid: false, message: 'Sessiya muddati tugagan' });
    }

    const table = await Table.findById(session.tableId)
      .populate('restaurantId');

    res.json({
      valid: true,
      table: {
        id: table._id,
        number: table.number,
        floor: table.floor
      },
      restaurant: {
        id: table.restaurantId._id,
        name: table.restaurantId.name
      },
      expiresAt: session.expiresAt,
      remainingMinutes: Math.floor((session.expiresAt - new Date()) / 1000 / 60)
    });
  } catch (error) {
    next(error);
  }
};

// Extend session
exports.extendSession = async (req, res, next) => {
  try {
    const sessionToken = req.headers['x-session-token'];

    if (!sessionToken) {
      return res.status(401).json({ success: false, message: 'Token topilmadi' });
    }

    const session = sessionStore.get(sessionToken);
    if (!session) {
      return res.status(401).json({ success: false, message: 'Sessiya topilmadi' });
    }

    // Extend by 1 hour
    const newExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
    session.expiresAt = newExpiresAt;
    sessionStore.set(sessionToken, session);

    res.json({
      success: true,
      newExpiresAt,
      remainingMinutes: 60
    });
  } catch (error) {
    next(error);
  }
};

// Validate session middleware
exports.validateSession = (req, res, next) => {
  const sessionToken = req.headers['x-session-token'];

  if (!sessionToken) {
    return res.status(401).json({
      success: false,
      message: 'Sessiya token talab qilinadi'
    });
  }

  const session = sessionStore.get(sessionToken);
  if (!session) {
    return res.status(401).json({
      success: false,
      message: 'Yaroqsiz sessiya'
    });
  }

  if (new Date() > session.expiresAt) {
    sessionStore.delete(sessionToken);
    return res.status(401).json({
      success: false,
      message: 'Sessiya muddati tugagan'
    });
  }

  // Attach session data to request
  req.session = session;
  next();
};
