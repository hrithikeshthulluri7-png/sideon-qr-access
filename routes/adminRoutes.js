const express = require('express');
const router = express.Router();
const { db } = require('../utils/database');

// API key guard — if ADMIN_API_KEY is set, require X-Admin-Key header to match
router.use((req, res, next) => {
  const required = process.env.ADMIN_API_KEY;
  if (!required) return next();
  const provided = req.headers['x-admin-key'] || req.query.key;
  if (provided !== required) {
    return res.status(401).json({ error: 'Unauthorized: invalid or missing admin key' });
  }
  next();
});

// GET /api/admin/stats
router.get('/stats', (req, res) => {
  db.get(`
    SELECT
      (SELECT COUNT(*) FROM members) AS totalMembers,
      (SELECT COUNT(*) FROM tokens WHERE checked_in_at IS NOT NULL) AS checkedIn,
      (SELECT COUNT(*) FROM tokens WHERE checked_in_at IS NULL AND expiresAt > datetime('now')) AS pending,
      (SELECT COUNT(*) FROM tokens WHERE expiresAt > datetime('now')) AS activeTokens
  `, (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { totalMembers: 0, checkedIn: 0, pending: 0, activeTokens: 0 });
  });
});

// GET /api/admin/members
router.get('/members', (req, res) => {
  db.all(`
    SELECT
      m.member_id,
      m.name,
      t.token,
      CASE WHEN t.checked_in_at IS NOT NULL THEN 'checked_in'
           WHEN t.expiresAt <= datetime('now') THEN 'expired'
           ELSE 'pending' END AS status,
      t.checked_in_at,
      t.expiresAt,
      t.created_at
    FROM members m
    LEFT JOIN tokens t ON m.member_id = t.member_id
    ORDER BY t.created_at DESC
    LIMIT 200
  `, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows || []);
  });
});

module.exports = router;
