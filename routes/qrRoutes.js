const express = require('express');
const router = express.Router();
const qrController = require('../controllers/qrController');

/**
 * QR Access Control Routes
 */

// Generate new QR token for a member
router.post('/generate-qr', qrController.generateQR);

// Verify a token and get member info
router.get('/verify', qrController.verifyToken);

// Check in (mark token as verified)
router.post('/check-in', qrController.checkIn);

// Get check-in status
router.get('/check-in-status', qrController.checkInStatus);

module.exports = router;
