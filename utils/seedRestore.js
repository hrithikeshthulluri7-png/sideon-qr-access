/**
 * seedRestore.js
 * Restores members with freshly-generated tokens if the DB is empty on startup.
 * All tokens are created at runtime — no token values are committed to source control.
 * The event PIN is read exclusively from the EVENT_PIN environment variable.
 */

const crypto = require('crypto');

// Member IDs to restore when the database is empty.
// No tokens or PIN values are stored here.
const SEED_MEMBER_IDS = [
  'SIDN_M004', 'SIDN_M005', 'SIDN_M006', 'SIDN_M007', 'SIDN_M008',
  'SIDN_M009', 'SIDN_M010', 'SIDN_M011', 'SIDN_M012', 'SIDN_M013',
  'SIDN_M014', 'SIDN_M015', 'SIDN_M016', 'SIDN_M017', 'SIDN_M018',
  'SIDN_M019', 'SIDN_M020', 'SIDN_M021', 'SIDN_M022', 'SIDN_M023',
  'SIDN_M024', 'SIDN_M026', 'SIDN_M027', 'SIDN_M028', 'SIDN_M029',
  'SIDN_M030',
];

const EXPIRES_AT = '2027-01-01T00:00:00.000Z';

function generateToken(memberId) {
  const suffix = memberId.replace('SIDN_', '');
  const rand = crypto.randomBytes(12).toString('hex');
  return `SIDN_EVENT_2026_${suffix}_${rand}`;
}

function seedRestoreIfEmpty(db, logger) {
  const eventPin = process.env.EVENT_PIN;
  if (!eventPin) {
    if (logger) logger.error('[seedRestore] EVENT_PIN env var is not set — seed restore skipped.');
    return;
  }

  db.get('SELECT COUNT(*) AS cnt FROM members', [], (err, row) => {
    if (err || (row && row.cnt > 0)) return;

    // Hash the PIN at restore time using bcrypt (loaded lazily to keep startup fast)
    let bcrypt;
    try { bcrypt = require('bcrypt'); } catch { bcrypt = require('bcryptjs'); }

    bcrypt.hash(eventPin, 10, (hashErr, pinHash) => {
      if (hashErr) {
        if (logger) logger.error('[seedRestore] Failed to hash EVENT_PIN', { error: hashErr.message });
        return;
      }

      if (logger) logger.info('[seedRestore] Empty DB detected — restoring members with freshly-generated tokens...');

      const now = new Date().toISOString();

      SEED_MEMBER_IDS.forEach((member_id) => {
        const label = member_id.replace('SIDN_', '');
        const name = `Member ${label}`;
        const token = generateToken(member_id);

        db.run(
          `INSERT OR IGNORE INTO members (member_id, name, admission_status, created_at, updated_at)
           VALUES (?, ?, 'admitted', ?, ?)`,
          [member_id, name, now, now],
          (insertErr) => {
            if (insertErr) return;
            db.run(`ALTER TABLE tokens ADD COLUMN pin_failed_attempts INTEGER DEFAULT 0`, () => {});
            db.run(`ALTER TABLE tokens ADD COLUMN checked_out_at DATETIME`, () => {});

            db.run(
              `INSERT OR IGNORE INTO tokens (member_id, token, pin_hash, expiresAt, created_at)
               VALUES (?, ?, ?, ?, ?)`,
              [member_id, token, pinHash, EXPIRES_AT, now],
              (tokenErr) => {
                if (tokenErr && logger)
                  logger.warn(`[seedRestore] Token insert failed for ${member_id}`, { error: tokenErr.message });
              }
            );
          }
        );
      });

      if (logger)
        logger.info(`[seedRestore] Restored ${SEED_MEMBER_IDS.length} members with fresh tokens. Update names via admin dashboard.`);
    });
  });
}

module.exports = { seedRestoreIfEmpty };
