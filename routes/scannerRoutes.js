const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const { db } = require('../utils/database');
const AuditLogger = require('../utils/auditLogger');
const { validateTokenFormat } = require('../utils/tokenGenerator');

// Shared: verify PIN and return row, or send error and return null
async function verifyPinAndGetRow(token, pin, res) {
  return new Promise((resolve) => {
    if (!token || !pin) {
      res.status(400).json({ error: 'token and pin required', code: 400 });
      return resolve(null);
    }
    if (!validateTokenFormat(token)) {
      res.status(400).json({ error: 'Invalid token format', code: 400 });
      return resolve(null);
    }

    db.get(
      `SELECT t.id, t.pin_hash, t.expiresAt, t.checked_in_at, t.checked_out_at,
              COALESCE(t.pin_failed_attempts, 0) AS pin_failed_attempts,
              t.member_id, m.name, m.email, m.mobile, m.agent,
              m.admission_status, m.admitted_at
       FROM tokens t JOIN members m ON t.member_id = m.member_id
       WHERE t.token = ?`,
      [token],
      async (err, row) => {
        if (err) { res.status(500).json({ error: 'Database error', code: 500 }); return resolve(null); }
        if (!row) { res.status(404).json({ error: 'Token not found', code: 404 }); return resolve(null); }

        if (new Date() > new Date(row.expiresAt)) {
          res.status(410).json({ error: 'Token expired', code: 410 });
          return resolve(null);
        }

        if (row.pin_failed_attempts >= 3) {
          res.status(423).json({ error: 'Too many failed attempts. Device locked.', code: 423, locked: true });
          return resolve(null);
        }

        const match = await bcrypt.compare(String(pin), row.pin_hash);
        if (!match) {
          const newCount = row.pin_failed_attempts + 1;
          db.run(`UPDATE tokens SET pin_failed_attempts = ? WHERE id = ?`, [newCount, row.id]);
          const attemptsLeft = 3 - newCount;
          res.status(401).json({
            error: attemptsLeft <= 0 ? 'Too many failed attempts. Device locked.' : 'Incorrect PIN',
            code: attemptsLeft <= 0 ? 423 : 401,
            attempts_left: attemptsLeft,
            locked: attemptsLeft <= 0
          });
          return resolve(null);
        }

        db.run(`UPDATE tokens SET pin_failed_attempts = 0 WHERE id = ?`, [row.id]);
        resolve(row);
      }
    );
  });
}

function memberPayload(row) {
  return {
    member_id: row.member_id,
    name: row.name,
    email: row.email || null,
    mobile: row.mobile || null,
    agent: row.agent || null,
  };
}

// POST /api/scanner/auth — verify PIN only, no check-in side effect
router.post('/auth', async (req, res) => {
  const { token, pin } = req.body;
  const row = await verifyPinAndGetRow(token, pin, res);
  if (!row) return;

  res.json({
    success: true,
    member: memberPayload(row),
    admission_status: row.admission_status,
    checked_in_at: row.checked_in_at || null,
    checked_out_at: row.checked_out_at || null,
    admitted_at: row.admitted_at || null,
  });
});

// POST /api/scanner/checkin — verify PIN + check in
router.post('/checkin', async (req, res) => {
  const { token, pin } = req.body;
  const row = await verifyPinAndGetRow(token, pin, res);
  if (!row) return;

  if (row.admission_status !== 'admitted') {
    return res.status(403).json({ error: 'Not yet admitted by admin', code: 403 });
  }
  if (row.checked_in_at) {
    return res.status(409).json({ error: 'Already checked in', code: 409, checked_in_at: row.checked_in_at });
  }

  const now = new Date().toISOString();
  db.run(
    `UPDATE tokens SET checked_in_at = ?, verified_at = ?, scan_count = scan_count + 1 WHERE id = ? AND checked_in_at IS NULL`,
    [now, now, row.id],
    function(err) {
      if (err || this.changes === 0) return res.status(409).json({ error: 'Already checked in', code: 409 });
      AuditLogger.log('scanner_checkin', row.member_id, token, 'success', null, 'scanner', { checkedInAt: now });
      res.json({ success: true, message: 'Checked in', checked_in_at: now });
    }
  );
});

// POST /api/scanner/checkout — verify PIN + check out
router.post('/checkout', async (req, res) => {
  const { token, pin } = req.body;
  const row = await verifyPinAndGetRow(token, pin, res);
  if (!row) return;

  if (!row.checked_in_at) {
    return res.status(409).json({ error: 'Not checked in yet', code: 409 });
  }
  if (row.checked_out_at) {
    return res.status(409).json({ error: 'Already checked out', code: 409, checked_out_at: row.checked_out_at });
  }

  const now = new Date().toISOString();
  db.run(
    `UPDATE tokens SET checked_out_at = ? WHERE id = ? AND checked_out_at IS NULL`,
    [now, row.id],
    function(err) {
      if (err || this.changes === 0) return res.status(409).json({ error: 'Already checked out', code: 409 });
      AuditLogger.log('scanner_checkout', row.member_id, token, 'success', null, 'scanner', { checkedOutAt: now });
      res.json({ success: true, message: 'Checked out', checked_out_at: now });
    }
  );
});

// GET /api/scanner/status?token=X — get current member status (no PIN required, read-only)
router.get('/status', (req, res) => {
  const { token } = req.query;
  if (!token || !validateTokenFormat(token)) {
    return res.status(400).json({ error: 'token required', code: 400 });
  }

  db.get(
    `SELECT t.checked_in_at, t.checked_out_at, t.member_id,
            m.name, m.email, m.mobile, m.agent, m.admission_status, m.admitted_at
     FROM tokens t JOIN members m ON t.member_id = m.member_id
     WHERE t.token = ?`,
    [token],
    (err, row) => {
      if (err) return res.status(500).json({ error: 'Database error', code: 500 });
      if (!row) return res.status(404).json({ error: 'Token not found', code: 404 });
      res.json({
        success: true,
        member: memberPayload(row),
        admission_status: row.admission_status,
        checked_in_at: row.checked_in_at || null,
        checked_out_at: row.checked_out_at || null,
        admitted_at: row.admitted_at || null,
      });
    }
  );
});

module.exports = router;
