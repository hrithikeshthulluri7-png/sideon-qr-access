/**
 * libsqlAdapter.js
 *
 * Wraps @libsql/client (Turso) to expose the same callback-based API
 * that sqlite3 uses: db.get(), db.run(), db.all(), db.serialize(), db.close().
 *
 * This lets every route/controller work unchanged while the database
 * lives permanently in Turso's cloud.
 *
 * Env vars:
 *   TURSO_DATABASE_URL  — e.g. libsql://sideon-prod-xxx.turso.io
 *   TURSO_AUTH_TOKEN    — token from `turso db tokens create <db>`
 *
 * Falls back to local SQLite file when env vars are absent (dev mode).
 */

const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');

function buildClient() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;

  if (url) {
    console.log('[DB] Connecting to Turso cloud database');
    return createClient({ url, authToken });
  }

  // Local fallback — use file:// SQLite via libsql
  const dbPath = process.env.DATABASE_URL || path.join(__dirname, '../data/sideon.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  console.log('[DB] No TURSO_DATABASE_URL — using local SQLite file:', dbPath);
  return createClient({ url: `file:${dbPath}` });
}

class LibsqlAdapter {
  constructor() {
    this._client = buildClient();
  }

  /** Convert a libsql Row to a plain JS object */
  _toObj(row, columns) {
    if (!row) return undefined;
    // Newer libsql versions return rows as objects already
    if (!Array.isArray(row) && typeof row === 'object') return row;
    // Older versions: array with column mapping
    return Object.fromEntries(columns.map((col, i) => [col, row[i]]));
  }

  /**
   * db.run(sql, [params], [callback])
   * callback is called as:  function(err)  where `this.changes` and `this.lastID` are set
   */
  run(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    if (!params) params = [];

    this._client.execute({ sql, args: params })
      .then(result => {
        if (typeof callback === 'function') {
          callback.call(
            {
              changes: result.rowsAffected,
              lastID: result.lastInsertRowid != null ? Number(result.lastInsertRowid) : 0,
            },
            null  // no error
          );
        }
      })
      .catch(err => {
        if (typeof callback === 'function') callback(err);
        else console.error('[DB run error]', sql, err.message);
      });
  }

  /**
   * db.get(sql, [params], callback)
   * callback(err, row)  — row is a plain object or undefined
   */
  get(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    if (!params) params = [];

    this._client.execute({ sql, args: params })
      .then(result => {
        const row = result.rows.length > 0
          ? this._toObj(result.rows[0], result.columns)
          : undefined;
        if (typeof callback === 'function') callback(null, row);
      })
      .catch(err => {
        if (typeof callback === 'function') callback(err);
        else console.error('[DB get error]', sql, err.message);
      });
  }

  /**
   * db.all(sql, [params], callback)
   * callback(err, rows)  — rows is an array of plain objects
   */
  all(sql, params, callback) {
    if (typeof params === 'function') { callback = params; params = []; }
    if (!params) params = [];

    this._client.execute({ sql, args: params })
      .then(result => {
        const rows = result.rows.map(r => this._toObj(r, result.columns));
        if (typeof callback === 'function') callback(null, rows);
      })
      .catch(err => {
        if (typeof callback === 'function') callback(err);
        else console.error('[DB all error]', sql, err.message);
      });
  }

  /**
   * db.serialize(callback)
   * sqlite3 uses this to serialise concurrent calls.
   * In our adapter, calls are already individual promises — just run the block.
   */
  serialize(callback) {
    if (typeof callback === 'function') callback();
  }

  /**
   * db.close(callback)
   */
  close(callback) {
    try { this._client.close(); } catch (e) { /* ignore */ }
    if (typeof callback === 'function') callback(null);
  }
}

module.exports = { LibsqlAdapter };
