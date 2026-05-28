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

// Verify JWT token (Phase 3)
router.post('/verify-jwt', qrController.verifyJWTToken);

// Check in (mark token as verified)
router.post('/check-in', qrController.checkIn);

// Get check-in status
router.get('/check-in-status', qrController.checkInStatus);

// Generate QR code image (Phase 3)
router.get('/generate-qr-image', qrController.generateQRImage);

// Verify PIN and check in (Phase 4)
router.post('/verify-pin', qrController.verifyPin);

// Poll admission status (Phase 4)
router.post('/get-admission-status', qrController.getAdmissionStatus);

module.exports = router;
