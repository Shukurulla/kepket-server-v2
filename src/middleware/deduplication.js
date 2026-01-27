/**
 * Request deduplication middleware
 * Bitta foydalanuvchidan qisqa vaqt ichida takroriy so'rovlarni oldini oladi
 * (masalan, tugma ikki marta bosilganda)
 */

// In-memory cache: key -> timestamp
const recentRequests = new Map();

// Eskirgan yozuvlarni tozalash (har 60 soniyada)
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of recentRequests) {
    if (now - timestamp > 30000) { // 30 soniyadan eski
      recentRequests.delete(key);
    }
  }
}, 60000);

/**
 * Deduplication middleware yaratish
 * @param {number} windowMs - Takroriy so'rovni bloklash oynasi (ms)
 * @returns {Function} Express middleware
 */
const deduplication = (windowMs = 3000) => {
  return (req, res, next) => {
    // Kalitni yaratish: userId + method + path + body hash
    const userId = req.user?._id || req.user?.id || req.ip;
    const bodyKey = JSON.stringify(req.body || {});
    const key = `${userId}:${req.method}:${req.originalUrl}:${bodyKey}`;

    const now = Date.now();
    const lastRequest = recentRequests.get(key);

    if (lastRequest && (now - lastRequest) < windowMs) {
      return res.status(409).json({
        success: false,
        message: 'Takroriy so\'rov. Iltimos, biroz kuting.',
        code: 'DUPLICATE_REQUEST'
      });
    }

    recentRequests.set(key, now);
    next();
  };
};

module.exports = { deduplication };
