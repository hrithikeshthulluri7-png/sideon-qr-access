# Rollback Plan — sideon-qr-access

Last verified: 2026-06-04

## Deploy target

Node.js / Express server. Database: Turso (SQLite, cloud-hosted at `sideon-prod`).

---

## How to roll back a bad deploy

### If the server crashes on startup

```bash
# Go back one commit
git checkout HEAD~1
npm install
# Restart the process (pm2 or systemd depending on host)
pm2 restart sideon-qr-access
```

### If the server starts but behaves wrongly

```bash
# Find the last known-good tag or commit
git log --oneline -10

# Reset to that commit
git checkout <commit-hash>
npm install
pm2 restart sideon-qr-access
```

### If Turso data is corrupted

Turso has point-in-time recovery on paid plans.
On free plan: restore from the most recent database backup file.

```bash
# List backups
ls ~/sideon-qr-access/backups/*.db

# Restore (replace the live DB URL with local restore)
# Update DATABASE_URL in .env to point to restored backup
# Then restart
```

---

## Database schema migrations

Every migration must have a matching down script:

```sql
-- Example: adding a column (up)
ALTER TABLE members ADD COLUMN notes TEXT;

-- Down (rollback)
-- SQLite does not support DROP COLUMN before v3.35.
-- Workaround: recreate table without the column.
CREATE TABLE members_backup AS SELECT member_id, name, email, mobile, agent,
  admission_status, admitted_at, admitted_by, created_at, updated_at FROM members;
DROP TABLE members;
ALTER TABLE members_backup RENAME TO members;
```

---

## Required env vars (startup will fail if missing)

```
JWT_SECRET
ADMIN_JWT_SECRET
ADMIN_SETUP_KEY
EVENT_PIN
```

If a deploy fails because these are missing:
1. Check `.env` file on the server
2. Re-add missing vars
3. Restart — the server will start cleanly

---

## Rollback SLA

**Target: back to working state within 5 minutes of a failed deploy.**

Steps that must be pre-tested before any major release:
- [ ] `git checkout <previous-commit>` works without errors
- [ ] `npm install` completes cleanly
- [ ] Server starts and `/api/health` returns 200
- [ ] At least one scan check-in succeeds in staging
