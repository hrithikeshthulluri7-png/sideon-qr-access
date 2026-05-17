const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = process.env.DATABASE_URL || path.join(__dirname, '../data/sideon.db');

// Create connection
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('[DB ERROR]', err.message);
  } else {
    console.log('[DB] Connected to SQLite database');
  }
});

// Enable foreign keys
db.run('PRAGMA foreign_keys = ON');

const initializeDatabase = () => {
  db.serialize(() => {
    // Members table
    db.run(`
      CREATE TABLE IF NOT EXISTS members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        mobile VARCHAR(20),
        agent VARCHAR(255),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) console.error('[DB ERROR] Members table:', err.message);
      else console.log('[DB] Members table ready');
    });

    // Tokens table
    db.run(`
      CREATE TABLE IF NOT EXISTS tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        member_id VARCHAR(50) NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        verified_at DATETIME,
        checked_in_at DATETIME,
        FOREIGN KEY (member_id) REFERENCES members(member_id) ON DELETE CASCADE
      )
    `, (err) => {
      if (err) console.error('[DB ERROR] Tokens table:', err.message);
      else console.log('[DB] Tokens table ready');
    });

    // Indexes for performance
    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens(token)`, (err) => {
      if (err) console.error('[DB ERROR] Index tokens_token:', err.message);
    });

    db.run(`CREATE INDEX IF NOT EXISTS idx_tokens_member_id ON tokens(member_id)`, (err) => {
      if (err) console.error('[DB ERROR] Index tokens_member_id:', err.message);
    });
  });
};

module.exports = {
  db,
  initializeDatabase
};
