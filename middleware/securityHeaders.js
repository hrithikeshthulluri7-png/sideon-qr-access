/**
 * Enhanced security headers middleware for production
 * - Configurable CORS based on environment
 * - Security headers (CSP, X-Frame-Options, etc.)
 * - HTTPS enforcement (in production)
 */

const logger = require('../utils/logger');

/**
 * Parse CORS origins from environment
 */
function getCorsOrigins() {
  const envOrigins = process.env.CORS_ORIGIN || 'http://localhost:8000,http://localhost:3000';
  return envOrigins.split(',').map(origin => origin.trim());
}

/**
 * CORS configuration based on environment
 */
function corsMiddleware(req, res, next) {
  const origins = getCorsOrigins();
  const origin = req.get('origin');
  const allowAll = origins.includes('*');

  if (allowAll || origins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', allowAll ? '*' : origin);
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Requested-With');

    if (!allowAll && process.env.CORS_CREDENTIALS === 'true') {
      res.set('Access-Control-Allow-Credentials', 'true');
    }
  }

  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }

  next();
}

/**
 * Security headers middleware
 */
function securityHeaders(req, res, next) {
  // Helmet-like headers
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('X-XSS-Protection', '1; mode=block');
  res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // Content Security Policy — allow inline scripts for our own HTML UI pages
  res.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: blob:; " +
    "font-src 'self'; " +
    "connect-src 'self'; " +
    "frame-ancestors 'none'; " +
    "base-uri 'self'; " +
    "form-action 'self'"
  );
  
  // Referrer Policy
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions Policy (formerly Feature Policy)
  res.set('Permissions-Policy', 
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), ' +
    'magnetometer=(), microphone=(), payment=(), usb=()'
  );

  next();
}

/**
 * Enforce HTTPS in production
 */
function httpsEnforce(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    // Check X-Forwarded-Proto for load balancers/reverse proxies
    const proto = req.get('x-forwarded-proto') || req.protocol;
    if (proto !== 'https') {
      logger.warn('Non-HTTPS request in production', {
        protocol: proto,
        path: req.path,
        ip: req.ip
      });
      return res.status(403).json({ error: 'HTTPS required' });
    }
  }
  next();
}

module.exports = {
  corsMiddleware,
  securityHeaders,
  httpsEnforce
};
