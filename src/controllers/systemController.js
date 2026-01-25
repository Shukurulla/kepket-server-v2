// TZ 5.1: Server vaqtini sinxronizatsiya qilish

/**
 * Get server time
 * GET /api/system/time
 */
exports.getServerTime = async (req, res, next) => {
  try {
    const serverTime = new Date();

    res.json({
      success: true,
      data: {
        serverTime: serverTime.toISOString(),
        timestamp: serverTime.getTime(),
        timezone: process.env.TZ || 'UTC',
        localTime: serverTime.toLocaleString('uz-UZ', { timeZone: 'Asia/Tashkent' })
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get system health status
 * GET /api/system/health
 */
exports.getHealth = async (req, res, next) => {
  try {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    res.json({
      success: true,
      data: {
        status: 'healthy',
        uptime: Math.floor(uptime),
        uptimeHuman: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + ' MB',
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + ' MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + ' MB'
        },
        nodeVersion: process.version,
        platform: process.platform
      }
    });
  } catch (error) {
    next(error);
  }
};
