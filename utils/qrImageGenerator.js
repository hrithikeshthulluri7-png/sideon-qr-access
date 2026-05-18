/**
 * QR Image Generator - Phase 3
 * Generates scannable QR code images from token strings
 * Uses the qrcode npm package for robust QR generation
 */

const QRCode = require('qrcode');

/**
 * Generate QR code image as PNG buffer
 * @param {string} token - The token string to encode in QR code
 * @param {object} options - Configuration options
 * @returns {Promise<Buffer>} PNG image buffer
 * @throws {Error} If token is invalid or image generation fails
 */
const generateQRImagePNG = async (token, options = {}) => {
  if (typeof token !== 'string') {
    throw new Error('Invalid token: must be a non-empty string');
  }

  if (token.length === 0) {
    throw new Error('Invalid token: token cannot be empty');
  }

  try {
    // Configure QR code options
    const qrOptions = {
      errorCorrectionLevel: options.errorCorrectionLevel || 'H', // High error correction
      type: 'image/png',
      width: options.width || 300, // Width in pixels
      margin: options.margin || 2, // Margin in module units
      color: {
        dark: options.darkColor || '#000000', // Black
        light: options.lightColor || '#FFFFFF' // White
      },
      ...options
    };

    // Generate QR code as PNG buffer
    const pngBuffer = await QRCode.toBuffer(token, qrOptions);
    return pngBuffer;
  } catch (error) {
    console.error('[QR ERROR] PNG generation failed:', error.message);
    throw new Error(`QR image generation failed: ${error.message}`);
  }
};

/**
 * Generate QR code image as SVG data URI
 * @param {string} token - The token string to encode in QR code
 * @param {object} options - Configuration options
 * @returns {Promise<string>} SVG as data:// URI
 * @throws {Error} If token is invalid or image generation fails
 */
const generateQRImageSVG = async (token, options = {}) => {
  if (typeof token !== 'string') {
    throw new Error('Invalid token: must be a non-empty string');
  }

  if (token.length === 0) {
    throw new Error('Invalid token: token cannot be empty');
  }

  try {
    // Configure QR code options - use 'svg' type for SVG output
    const qrOptions = {
      errorCorrectionLevel: options.errorCorrectionLevel || 'H',
      type: 'svg',
      width: options.width || 300,
      margin: options.margin || 2,
      color: {
        dark: options.darkColor || '#000000',
        light: options.lightColor || '#FFFFFF'
      }
    };

    // Generate QR code as SVG string
    const svgString = await QRCode.toString(token, qrOptions);

    // Convert to data URI for easy embedding in HTML
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svgString).toString('base64')}`;
    return dataUri;
  } catch (error) {
    console.error('[QR ERROR] SVG generation failed:', error.message);
    throw new Error(`QR SVG generation failed: ${error.message}`);
  }
};

/**
 * Generate QR code and return as base64-encoded PNG
 * Useful for embedding in JSON responses
 * @param {string} token - The token string to encode in QR code
 * @param {object} options - Configuration options
 * @returns {Promise<string>} Base64-encoded PNG data
 * @throws {Error} If token is invalid or image generation fails
 */
const generateQRImageBase64 = async (token, options = {}) => {
  try {
    const buffer = await generateQRImagePNG(token, options);
    return buffer.toString('base64');
  } catch (error) {
    console.error('[QR ERROR] Base64 generation failed:', error.message);
    throw error;
  }
};

/**
 * Validate token format (basic check)
 * Ensures token is a string and not empty
 * @param {any} token - Value to validate
 * @returns {boolean} True if valid token format
 */
const isValidToken = (token) => {
  return typeof token === 'string' && token.length > 0 && token.length <= 1000;
};

module.exports = {
  generateQRImagePNG,
  generateQRImageSVG,
  generateQRImageBase64,
  isValidToken
};
