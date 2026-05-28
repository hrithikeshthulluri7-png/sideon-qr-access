const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { db } = require('../utils/database');
const adminAuthMiddleware = require('../middleware/adminAuthMiddleware');

const JWT_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET || 'sideon-admin-secret-change-in-production';
const JWT_EXPIRES = process.env.ADMIN_JWT_EXPIRES || '8h';

// POST /api/admin/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'email and password required', code: 400 });
    }

    db.get('SELECT * FROM admin_users WHERE email = ?', [email], async (err, admin) => {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (!admin) return res.status(401).json({ error: 'Invalid credentials', code: 401 });

      const match = await bcrypt.compare(password, admin.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid credentials', code: 401 });

      const token = jwt.sign(
        { id: admin.id, email: admin.email, name: admin.name, role: 'admin' },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES }
      );

      res.json({ success: true, token, admin: { id: admin.id, email: admin.email, name: admin.name } });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// POST /api/admin/create-admin (protected by setup key for initial setup)
router.post('/create-admin', async (req, res) => {
  try {
    const { email, password, name, setup_key } = req.body;
    const SETUP_KEY = process.env.ADMIN_SETUP_KEY || 'sideon-setup-2026';
    if (setup_key !== SETUP_KEY) {
      return res.status(403).json({ error: 'Invalid setup key', code: 403 });
    }
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, and name required', code: 400 });
    }

    const hash = await bcrypt.hash(password, 12);
    db.run(
      'INSERT INTO admin_users (email, password_hash, name) VALUES (?, ?, ?)',
      [email, hash, name],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(409).json({ error: 'Admin with this email already exists', code: 409 });
          }
          return res.status(500).json({ error: 'Database error', code: 500 });
        }
        res.status(201).json({ success: true, message: 'Admin created', id: this.lastID });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// POST /api/admin/change-password — no JWT needed, verified by old password
router.post('/change-password', async (req, res) => {
  try {
    const { email, old_password, new_password } = req.body;
    if (!email || !old_password || !new_password) {
      return res.status(400).json({ error: 'email, old_password, and new_password required', code: 400 });
    }
    if (new_password.length < 6) {
      return res.status(400).json({ error: 'new_password must be at least 6 characters', code: 400 });
    }

    db.get('SELECT * FROM admin_users WHERE email = ?', [email], async (err, admin) => {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (!admin) return res.status(401).json({ error: 'Invalid credentials', code: 401 });

      const match = await bcrypt.compare(old_password, admin.password_hash);
      if (!match) return res.status(401).json({ error: 'Old password is incorrect', code: 401 });

      const newHash = await bcrypt.hash(new_password, 12);
      db.run('UPDATE admin_users SET password_hash = ? WHERE email = ?', [newHash, email], function(updateErr) {
        if (updateErr) return res.status(500).json({ error: 'Database error', code: 500 });
        res.json({ success: true, message: 'Password changed successfully' });
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', code: 500 });
  }
});

// All routes below require admin JWT
router.use(adminAuthMiddleware);

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  db.get(`
    SELECT
      (SELECT COUNT(*) FROM members) AS totalMembers,
      (SELECT COUNT(*) FROM tokens WHERE checked_in_at IS NOT NULL AND checked_out_at IS NULL) AS checkedIn,
      (SELECT COUNT(*) FROM tokens WHERE checked_out_at IS NOT NULL) AS checkedOut,
      (SELECT COUNT(*) FROM members WHERE admission_status = 'pending') AS pendingAdmission,
      (SELECT COUNT(*) FROM members WHERE admission_status = 'admitted') AS admitted,
      (SELECT COUNT(*) FROM members WHERE admission_status = 'declined') AS declined
  `, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || {});
  });
});

// GET /api/admin/members — ALL members, permanently listed, no expiry filter
router.get('/members', (req, res) => {
  db.all(`
    SELECT
      m.member_id, m.name, m.email, m.mobile, m.agent,
      m.admission_status, m.admitted_at, m.admitted_by,
      t.token,
      CASE
        WHEN t.checked_out_at IS NOT NULL THEN 'checked_out'
        WHEN t.checked_in_at IS NOT NULL THEN 'checked_in'
        WHEN m.admission_status = 'admitted' THEN 'admitted'
        WHEN m.admission_status = 'declined' THEN 'declined'
        ELSE 'pending'
      END AS check_in_status,
      t.checked_in_at, t.checked_out_at, t.expiresAt, t.created_at
    FROM members m
    LEFT JOIN tokens t ON m.member_id = t.member_id
    ORDER BY COALESCE(t.created_at, m.created_at) DESC
    LIMIT 500
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// GET /api/admin/pending — members awaiting admission decision (no expiry limit)
router.get('/pending', (req, res) => {
  db.all(`
    SELECT m.member_id, m.name, m.email, m.mobile, m.agent, m.created_at, t.token, t.expiresAt
    FROM members m
    LEFT JOIN tokens t ON m.member_id = t.member_id
    WHERE m.admission_status = 'pending'
    ORDER BY m.created_at ASC
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

// POST /api/admin/admit
router.post('/admit', (req, res) => {
  const { member_id } = req.body;
  if (!member_id) return res.status(400).json({ error: 'member_id required', code: 400 });

  const adminEmail = req.admin?.email || 'admin';
  const now = new Date().toISOString();

  db.run(
    `UPDATE members SET admission_status = 'admitted', admitted_at = ?, admitted_by = ? WHERE member_id = ?`,
    [now, adminEmail, member_id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (this.changes === 0) return res.status(404).json({ error: 'Member not found', code: 404 });
      res.json({ success: true, message: `Member ${member_id} admitted`, admitted_at: now });
    }
  );
});

// POST /api/admin/checkout — admin-initiated checkout
router.post('/checkout', (req, res) => {
  const { member_id } = req.body;
  if (!member_id) return res.status(400).json({ error: 'member_id required', code: 400 });

  const checkedOutAt = new Date().toISOString();
  db.run(
    `UPDATE tokens SET checked_out_at = ?
     WHERE member_id = ? AND checked_in_at IS NOT NULL AND checked_out_at IS NULL`,
    [checkedOutAt, member_id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (this.changes === 0) return res.status(409).json({ error: 'Member not checked in or already checked out', code: 409 });
      res.json({ success: true, message: `Member ${member_id} checked out`, checked_out_at: checkedOutAt });
    }
  );
});

// DELETE /api/admin/members/:member_id — permanently remove a member and all their tokens
router.delete('/members/:member_id', (req, res) => {
  const { member_id } = req.params;
  if (!member_id) return res.status(400).json({ error: 'member_id required', code: 400 });

  db.run('DELETE FROM members WHERE member_id = ?', [member_id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error', code: 500 });
    if (this.changes === 0) return res.status(404).json({ error: 'Member not found', code: 404 });
    res.json({ success: true, message: `Member ${member_id} removed` });
  });
});

// POST /api/admin/reset-pin-lock — unlock a PIN-locked token
router.post('/reset-pin-lock', (req, res) => {
  const { member_id } = req.body;
  if (!member_id) return res.status(400).json({ error: 'member_id required', code: 400 });

  db.run('UPDATE tokens SET pin_failed_attempts = 0 WHERE member_id = ?', [member_id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error', code: 500 });
    res.json({ success: true, message: `PIN lock reset for ${member_id}` });
  });
});

// POST /api/admin/decline
router.post('/decline', (req, res) => {
  const { member_id } = req.body;
  if (!member_id) return res.status(400).json({ error: 'member_id required', code: 400 });

  db.run(
    `UPDATE members SET admission_status = 'declined' WHERE member_id = ?`,
    [member_id],
    function(err) {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (this.changes === 0) return res.status(404).json({ error: 'Member not found', code: 404 });
      res.json({ success: true, message: `Member ${member_id} declined` });
    }
  );
});

module.exports = router;
