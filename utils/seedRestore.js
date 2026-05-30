/**
 * seedRestore.js
 * Automatically restores members + tokens from QR codes if DB is empty.
 * Run automatically on server startup via database.js.
 */

const SEED_MEMBERS = [
  { member_id: 'SIDN_M004',  token: 'SIDN_EVENT_2026_M004_d908570fb4808653cbcd60a7'  },
  { member_id: 'SIDN_M005',  token: 'SIDN_EVENT_2026_M005_2f5e387da25c1152f3c2d41a'  },
  { member_id: 'SIDN_M006',  token: 'SIDN_EVENT_2026_M006_0f2c3ad6c3b209d219a5694f'  },
  { member_id: 'SIDN_M007',  token: 'SIDN_EVENT_2026_M007_6d0d39dce5c11341ea92b81f'  },
  { member_id: 'SIDN_M008',  token: 'SIDN_EVENT_2026_M008_979572984affdee60fcb8888'  },
  { member_id: 'SIDN_M009',  token: 'SIDN_EVENT_2026_M009_9a144fdc27cfb9f223120ba0'  },
  { member_id: 'SIDN_M010',  token: 'SIDN_EVENT_2026_M010_c9e0ef3ad240b4a931010c7a'  },
  { member_id: 'SIDN_M011',  token: 'SIDN_EVENT_2026_M011_43ea60070a9cdb72a8982f67'  },
  { member_id: 'SIDN_M012',  token: 'SIDN_EVENT_2026_M012_5804ef03f7b4d953a499f4de'  },
  { member_id: 'SIDN_M013',  token: 'SIDN_EVENT_2026_M013_a744787fa525710401cb558f'  },
  { member_id: 'SIDN_M014',  token: 'SIDN_EVENT_2026_M014_eab35948814dbb9e2cfb2c77'  },
  { member_id: 'SIDN_M015',  token: 'SIDN_EVENT_2026_M015_677e2c12410252f5287daf16'  },
  { member_id: 'SIDN_M016',  token: 'SIDN_EVENT_2026_M016_5fd53d6bf1f038e82e1f1b83'  },
  { member_id: 'SIDN_M017',  token: 'SIDN_EVENT_2026_M0017_d94a7d8ab9c7e6793db4e391' },
  { member_id: 'SIDN_M018',  token: 'SIDN_EVENT_2026_M018_8ca682f41b479b18750631fd'  },
  { member_id: 'SIDN_M019',  token: 'SIDN_EVENT_2026_M0019_5a1040fa24a98134c2b1097a' },
  { member_id: 'SIDN_M020',  token: 'SIDN_EVENT_2026_M020_accbc34ae407b71c4145e4e7'  },
  { member_id: 'SIDN_M021',  token: 'SIDN_EVENT_2026_M021_23b72908418cd8ed19c60fd2'  },
  { member_id: 'SIDN_M022',  token: 'SIDN_EVENT_2026_M022_f9120dec383979094c4bb1f6'  },
  { member_id: 'SIDN_M023',  token: 'SIDN_EVENT_2026_M023_4ae92007f24768ba748a7a1e'  },
  { member_id: 'SIDN_M024',  token: 'SIDN_EVENT_2026_M024_7cb92807a07c0635c3de88b5'  },
  { member_id: 'SIDN_M026',  token: 'SIDN_EVENT_2026_M0026_0629afbf4935add93ab016ca' },
  { member_id: 'SIDN_M027',  token: 'SIDN_EVENT_2026_M0027_cc24b9e1314f84a2a8668d31' },
  { member_id: 'SIDN_M028',  token: 'SIDN_EVENT_2026_M028_9a0e99d504cb38dafc4c4a5a'  },
  { member_id: 'SIDN_M029',  token: 'SIDN_EVENT_2026_M029_a4ec7f0eb124de3cc1206b19'  },
  { member_id: 'SIDN_M030',  token: 'SIDN_EVENT_2026_M030_b189f534e5eb4f3b7d411f1b'  },
];

// bcrypt hash of event PIN "369874" (rounds=10)
const PIN_HASH = '$2b$10$MlHrZ8s3hSlX.m.hXWGBeuRazltfpMi9Ni8CZkv56x6iNXdVVRLRO';
const EXPIRES_AT = '2027-01-01T00:00:00.000Z';

function seedRestoreIfEmpty(db, logger) {
  db.get('SELECT COUNT(*) AS cnt FROM members', [], (err, row) => {
    if (err || (row && row.cnt > 0)) return; // DB has data or error — skip

    if (logger) logger.info('[seedRestore] Empty DB detected — restoring members from QR backup...');

    const now = new Date().toISOString();

    SEED_MEMBERS.forEach(({ member_id, token }) => {
      const label = member_id.replace('SIDN_', ''); // e.g. "M004"
      const name = `Member ${label}`;

      db.run(
        `INSERT OR IGNORE INTO members (member_id, name, admission_status, created_at, updated_at)
         VALUES (?, ?, 'admitted', ?, ?)`,
        [member_id, name, now, now],
        (err) => {
          if (err) return;
          // Ensure pin_failed_attempts column exists (migration guard)
          db.run(`ALTER TABLE tokens ADD COLUMN pin_failed_attempts INTEGER DEFAULT 0`, () => {});
          db.run(`ALTER TABLE tokens ADD COLUMN checked_out_at DATETIME`, () => {});

          db.run(
            `INSERT OR IGNORE INTO tokens (member_id, token, pin_hash, expiresAt, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [member_id, token, PIN_HASH, EXPIRES_AT, now],
            (err2) => {
              if (err2 && logger) logger.warn(`[seedRestore] Token insert failed for ${member_id}`, { error: err2.message });
            }
          );
        }
      );
    });

    if (logger) logger.info(`[seedRestore] Restored ${SEED_MEMBERS.length} members. Update names via admin dashboard.`);
  });
}

module.exports = { seedRestoreIfEmpty };
