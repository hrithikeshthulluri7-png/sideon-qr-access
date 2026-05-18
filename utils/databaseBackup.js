const fs = require('fs');
const path = require('path');
const { db } = require('./database');
const logger = require('./logger');

const BACKUP_DIR = process.env.DATABASE_BACKUP_DIR || path.join(__dirname, '../data/backups');
const RETENTION_DAYS = parseInt(process.env.DATABASE_BACKUP_RETENTION_DAYS || '30');

// Ensure backup directory exists
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Create a backup of the SQLite database
 */
async function backupDatabase() {
  return new Promise((resolve, reject) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `sideon-${timestamp}.db.backup`);

    // Use SQLite backup API
    db.serialize(() => {
      db.run(`PRAGMA optimize`, (err) => {
        if (err) {
          logger.warn('Database optimization before backup failed', { error: err.message });
        }

        // Simple backup: copy the database file
        const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../data/sideon.db');
        
        try {
          if (fs.existsSync(dbPath)) {
            fs.copyFileSync(dbPath, backupPath);
            logger.info('Database backup created', { path: backupPath });
            cleanOldBackups();
            resolve(backupPath);
          } else {
            reject(new Error(`Database file not found: ${dbPath}`));
          }
        } catch (err) {
          logger.error('Backup creation failed', { error: err.message });
          reject(err);
        }
      });
    });
  });
}

/**
 * Restore database from backup
 */
async function restoreDatabase(backupPath) {
  return new Promise((resolve, reject) => {
    const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../data/sideon.db');

    try {
      if (!fs.existsSync(backupPath)) {
        return reject(new Error(`Backup file not found: ${backupPath}`));
      }

      // Close existing connection
      db.close((err) => {
        if (err) {
          logger.warn('Error closing database before restore', { error: err.message });
        }

        // Restore from backup
        fs.copyFileSync(backupPath, dbPath);
        logger.info('Database restored from backup', { from: backupPath, to: dbPath });
        
        // Reconnect
        require('./database');
        resolve();
      });
    } catch (err) {
      logger.error('Restore failed', { error: err.message });
      reject(err);
    }
  });
}

/**
 * Clean old backups based on retention policy
 */
function cleanOldBackups() {
  try {
    const cutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const files = fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db.backup'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime()
      }));

    let deletedCount = 0;
    files.forEach(file => {
      if (file.time < cutoffTime) {
        fs.unlinkSync(file.path);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      logger.info('Old backups cleaned', { count: deletedCount, retentionDays: RETENTION_DAYS });
    }
  } catch (err) {
    logger.error('Backup cleanup failed', { error: err.message });
  }
}

/**
 * Enable WAL (Write-Ahead Logging) for better concurrency
 */
function enableWAL() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('PRAGMA journal_mode = WAL', (err) => {
        if (err) {
          logger.error('Failed to enable WAL', { error: err.message });
          reject(err);
        } else {
          logger.info('WAL (Write-Ahead Logging) enabled');
          // Set WAL checkpoint frequency
          db.run('PRAGMA wal_autocheckpoint = 1000', (err) => {
            if (err) {
              logger.warn('Failed to set WAL autocheckpoint', { error: err.message });
            } else {
              logger.info('WAL autocheckpoint configured');
            }
            resolve();
          });
        }
      });
    });
  });
}

/**
 * Get list of available backups
 */
function listBackups() {
  try {
    return fs
      .readdirSync(BACKUP_DIR)
      .filter(f => f.endsWith('.db.backup'))
      .map(f => ({
        name: f,
        path: path.join(BACKUP_DIR, f),
        size: fs.statSync(path.join(BACKUP_DIR, f)).size,
        created: fs.statSync(path.join(BACKUP_DIR, f)).mtime
      }))
      .sort((a, b) => b.created - a.created);
  } catch (err) {
    logger.error('Failed to list backups', { error: err.message });
    return [];
  }
}

/**
 * Get database size info
 */
function getDatabaseStats() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.all(`
        SELECT 
          name,
          SUM(pgsize) as size
        FROM pragma_page_count()
        JOIN pragma_page_size()
      `, (err, pages) => {
        if (err) {
          logger.error('Failed to get database stats', { error: err.message });
          return reject(err);
        }

        db.all(`
          SELECT 
            name,
            COUNT(*) as count
          FROM pragma_table_info(?)
        `, (err, tables) => {
          if (err) {
            return reject(err);
          }

          resolve({
            pageCount: pages,
            tables: tables
          });
        });
      });
    });
  });
}

module.exports = {
  backupDatabase,
  restoreDatabase,
  cleanOldBackups,
  enableWAL,
  listBackups,
  getDatabaseStats
};
