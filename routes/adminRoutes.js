const express = require('express');
const router = express.Router();
const { db } = require('../utils/database');

// Admin routes are open — dashboard has no way to pass a secret key.

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
