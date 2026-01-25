require('dotenv').config();

module.exports = {
  // Server
  PORT: process.env.PORT || 3010,
  NODE_ENV: process.env.NODE_ENV || 'development',

  // Database
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket_v2?authSource=admin',

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || 'kepket-restoran-super-secret-jwt-key-2024',
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN || '7d',

  // CORS
  CORS_ORIGIN: process.env.CORS_ORIGIN || '*',

  // Feature flags
  ENABLE_SOCKET_LOGGING: process.env.ENABLE_SOCKET_LOGGING === 'true' || true,
  ENABLE_REQUEST_LOGGING: process.env.ENABLE_REQUEST_LOGGING === 'true' || true,

  // Firebase Admin SDK
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'kepket-60c57',
  FIREBASE_PRIVATE_KEY_ID: process.env.FIREBASE_PRIVATE_KEY_ID || '129e5b0870db773705feb8d25a2aa2932aee8873',
  FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY || '-----BEGIN PRIVATE KEY-----\nMIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDVA6tA0tOM2vpj\nrjeAi2zlEd9rcp+URhhLBUZlwD636viBXC+UQ5xwM4Nv8QxRayx0Z3nXtJ4pusAR\nDYEWORN0CSBBZeJmehosYwoG1qM+N5EMltOEUtdb81rPeOLb2VP2dlZ9u8P9gmE3\now9D0QISo6sPdGAN6mUL4MrM1g0UDt7NJMJWDiFa0Sth45G9ciRVnYDmSL21v5ub\n/zrP8MCr3K6ED7be1f+WgJwXxmZd7Ju1W7A0rnhHqEfyMcURCU/bMuQSIP04Lay1\nGWEAokirOHZuZdqmiBjS5fHXR2sOmWOmM+IAlSSFO5utYiFlUhFrbyzHjWvvsePZ\n85l0pqUpAgMBAAECggEABJ1oO+bKuNio/Q4yBfcUpwp8ldDYE+Jy4J6JeGcyVKdi\ntowUkc3nLpJxzLPjCZkx+jGgX6PPm2WAMhO3Ug/EKUrl/SoOaMbzbeEVagbYvDPV\npiQBtXJarRN4H6+QRqVjiXQ7NSJ4wV4Y6hd+cKsvXs+smJCeYMl3t/VTn3LHD2yl\nmNNlx0kzd5DJqdwazUuP0Y3CaR9OrY9k/ItsR4SGFe3mJDquYlEh9b0lgWOqzmZb\n9ZcLGd5KIngljpBl5MHX5KkPZ1xpC+GaziGQFT9WLtyT6O/9Q60LL+AbMNnMNc48\nLNGxpl94+YVtHcppREM5KEa7L0y6WnOrSoaYzdvowQKBgQDs1HUpEkPwy0sg4KyS\nQmqa2ApnjmmR36XRKATCGziS9eAiDHke4jB86m5YCeRVNLIMn8zihxuf3GJVji0Q\njEba0sw1qkYZELPSZNEzCuEPd8S7c74l80HoJLd4llhOiS8OJUROTMwkwwGyUbAG\nDRELebGypiQEAWBE08sCbY7l2QKBgQDmQbWmbIMLbibUcogqSl9LQ+TIWTb8FHjz\nyI6IKZ8JqKWZk3odj8VIsqnL4Dw+SOb0LuPP09j7j7vcNJtbFychEjS5zxyoiqU2\nSR+ptkXJ42kiOtS+xHe1P2SFwyzDlUq5cRfCkafhf74MemcAFnH9aPhxcLsOOlet\neSbgsHqX0QKBgFpDN0wqC/7wXHfxaZRs/9h4Uq7ZVl8kkDxBNl8MpOlOENipTFh6\n+OQDLX8cdgwLg3jQRvRnbh3ljwzwnThbXn30LaSeewz+kqqzhhAgK1sL2M1g9a3d\nItdpdwvcsVdtbaPEjF4TYxL3x+PAwofr3v0yqoleTQfBxoE0/4CzZO0xAoGAbILI\n/U4kD63whKwY+X0lHY44ciaBIBjxy0lXyll7Bo1AxXhX0zie65yvIlJhcaTfmnHC\nkH2wwxTAnoz4LdxiZ1ZyHKK7Sb5VD5k0X8FzcCpIsIXzHpfuJi9iyxrorJ9doLjo\nTpxf9ohB4xWIFuV9AMSIWMWckZ7zFOCEbt0cWRECgYBN4fKxJob5eAwXFTIUqoel\nAOPPKKgjMsBBPfCdBOI+ll1j+HK427qyubYIAUzYSTs3+r1dhNMntj1fpsuTauj3\n6WQaQblKPRz9s3wMi6i5ZEuUzOEg6v1+hQd82wsQRH2nUmO2maq6Rs98OoPHr0cC\nvPJZ0G/nN0BWKnhhTLnCaw==\n-----END PRIVATE KEY-----\n',
  FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL || 'firebase-adminsdk-fbsvc@kepket-60c57.iam.gserviceaccount.com',
  FIREBASE_CLIENT_ID: process.env.FIREBASE_CLIENT_ID || '101447597283820300174',
  FIREBASE_CERT_URL: process.env.FIREBASE_CERT_URL || 'https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-fbsvc%40kepket-60c57.iam.gserviceaccount.com',

  // Old database (for migration)
  OLD_MONGODB_URI: process.env.OLD_MONGODB_URI || 'mongodb://root:SuperStrongPassword123@109.205.176.124:27017/kepket?authSource=admin'
};
