const logger = require('../utils/logger');

/**
 * Request validation middleware for production
 * - Validates Content-Type for POST/PUT requests
 * - Validates Content-Length limits
 * - Sanitizes request headers
 */

const MAX_CONTENT_LENGTH = process.env.MAX_CONTENT_LENGTH || 1024 * 100; // 100KB default
const ALLOWED_CONTENT_TYPES = ['application/json', 'application/x-www-form-urlencoded'];

/**
 * Validate Content-Type for POST/PUT/PATCH requests
 */
function validateContentType(req, res, next) {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  const contentType = req.get('content-type');
  if (!contentType) {
    logger.warn('Missing Content-Type header', { method: req.method, path: req.path });
    return res.status(400).json({ error: 'Content-Type header is required' });
  }

  const baseType = contentType.split(';')[0].trim();
  if (!ALLOWED_CONTENT_TYPES.includes(baseType)) {
    logger.warn('Invalid Content-Type', { method: req.method, path: req.path, contentType });
    return res.status(415).json({ error: 'Unsupported Media Type' });
  }

  next();
}

/**
 * Validate Content-Length
 */
function validateContentLength(req, res, next) {
  const contentLength = parseInt(req.get('content-length') || '0');
  if (contentLength > MAX_CONTENT_LENGTH) {
    logger.warn('Content-Length exceeds limit', {
      method: req.method,
      path: req.path,
      contentLength,
      maxLength: MAX_CONTENT_LENGTH
    });
    return res.status(413).json({ error: 'Payload Too Large' });
  }
  next();
}

/**
 * Sanitize request headers - remove potentially dangerous headers
 */
function sanitizeHeaders(req, res, next) {
  const dangerousHeaders = ['x-original-host', 'x-forwarded-host'];
  dangerousHeaders.forEach(header => {
    if (req.get(header)) {
      delete req.headers[header];
    }
  });
  next();
}

module.exports = {
  validateContentType,
  validateContentLength,
  sanitizeHeaders
};
