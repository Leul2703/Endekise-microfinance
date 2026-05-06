const rateLimit = require('express-rate-limit');

/**
 * Create rate limiter for specific endpoints
 * @param {Object} options - Rate limiter options
 * @returns {Function} Express middleware
 */
const createRateLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please try again later.',
    skip: (req) => {
      // Skip rate limiting for trusted IPs if needed
      return false;
    }
  };

  return rateLimit({ ...defaultOptions, ...options });
};

// Pre-configured rate limiters for different endpoint types
const rateLimiters = {
  // Strict rate limiter for authentication endpoints
  auth: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 attempts per 15 minutes (increased for development)
    message: 'Too many authentication attempts. Account temporarily locked.',
    skipSuccessfulRequests: true
  }),

  // Moderate rate limiter for financial operations (increased for development)
  financial: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5000, // 5000 financial operations per 15 minutes (increased for development)
    message: 'Too many financial operations. Please wait before trying again.'
  }),

  // Lenient rate limiter for read operations (increased for development)
  read: createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10000, // 10000 read requests per 15 minutes (increased for development)
    message: 'Too many read requests. Please slow down.'
  }),

  // Strict rate limiter for file uploads (increased for development)
  upload: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 500, // 500 uploads per hour (increased for development)
    message: 'Upload limit reached. Please try again later.'
  }),

  // Strict rate limiter for admin operations (increased for development)
  admin: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 2000, // 2000 admin operations per hour (increased for development)
    message: 'Too many admin operations. Please wait before trying again.'
  })
};

module.exports = { createRateLimiter, rateLimiters };
