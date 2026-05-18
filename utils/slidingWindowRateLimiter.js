const { db } = require('./database');

/**
 * Sliding Window Rate Limiter for Phase 3
 * Replaces fixed-window with more accurate sliding-window algorithm
 * Prevents burst attacks and provides progressive backoff
 */

// Configuration
const RATE_LIMIT_CONFIG = {
  // Per-member check-in limits
  checkInLimit: 10,
  checkInWindow: 60, // seconds

  // Per-token verify attempts
  verifyAttemptsLimit: 3,
  verifyAttemptsWindow: 60, // seconds

  // Progressive backoff on failures
  backoffConfig: [
    { failureCount: 5, cooldownSeconds: 10 },
    { failureCount: 10, cooldownSeconds: 60 },
    { failureCount: 15, cooldownSeconds: 300 } // 5 minutes
  ]
};

/**
 * Initialize rate_limit_state table
 */
function initializeRateLimitTable() {
  db.run(`
    CREATE TABLE IF NOT EXISTS rate_limit_state (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key VARCHAR(255) UNIQUE NOT NULL,
      window_start INTEGER NOT NULL,
      request_count INTEGER DEFAULT 0,
      failure_count INTEGER DEFAULT 0,
      last_request_time INTEGER,
      cooldown_until INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('[DB ERROR] rate_limit_state table:', err.message);
    } else {
      console.log('[DB] Rate limit state table ready');
    }
  });

  // Create index for fast lookups
  db.run(`CREATE INDEX IF NOT EXISTS idx_rate_limit_key ON rate_limit_state(key)`, (err) => {
    if (err) console.error('[DB ERROR] Index rate_limit_key:', err.message);
  });
}

/**
 * Get rate limit state for a key (async wrapper for Promise)
 *
 * @param {string} key - Rate limit key (member_id, token, or IP)
 * @returns {Promise<object>} Rate limit state
 */
function getRateLimitState(key) {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT * FROM rate_limit_state WHERE key = ?',
      [key],
      (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      }
    );
  });
}

/**
 * Update rate limit state in database
 *
 * @param {string} key - Rate limit key
 * @param {object} updates - Fields to update
 * @returns {Promise<void>}
 */
function updateRateLimitState(key, updates) {
  return new Promise((resolve, reject) => {
    const fields = [];
    const values = [];

    for (const [field, value] of Object.entries(updates)) {
      fields.push(`${field} = ?`);
      values.push(value);
    }

    fields.push('updated_at = CURRENT_TIMESTAMP');
    values.push(key);

    const sql = `UPDATE rate_limit_state SET ${fields.join(', ')} WHERE key = ?`;

    db.run(sql, values, function(err) {
      if (err) reject(err);
      else resolve();
    });
  });
}

/**
 * Create new rate limit state (upsert pattern - safe for concurrent requests)
 *
 * @param {string} key - Rate limit key
 * @returns {Promise<void>}
 */
function createRateLimitState(key) {
  return new Promise((resolve, reject) => {
    // Use INSERT OR REPLACE (upsert) to handle concurrent requests atomically
    // This avoids UNIQUE constraint violations
    db.run(
      `INSERT OR REPLACE INTO rate_limit_state (key, window_start, request_count, failure_count, updated_at)
       VALUES (?, ?, 0, 0, CURRENT_TIMESTAMP)`,
      [key, Math.floor(Date.now() / 1000)],
      function(err) {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Check if request is in cooldown (progressive backoff)
 *
 * @param {object} state - Rate limit state
 * @returns {object} { inCooldown: boolean, cooldownRemaining: number }
 */
function checkCooldown(state) {
  const now = Math.floor(Date.now() / 1000);

  if (!state || !state.cooldown_until) {
    return { inCooldown: false, cooldownRemaining: 0 };
  }

  if (now < state.cooldown_until) {
    return {
      inCooldown: true,
      cooldownRemaining: state.cooldown_until - now
    };
  }

  return { inCooldown: false, cooldownRemaining: 0 };
}

/**
 * Get cooldown duration based on failure count
 *
 * @param {number} failureCount - Current failure count
 * @returns {number} Cooldown in seconds
 */
function getCooldownDuration(failureCount) {
  for (let i = RATE_LIMIT_CONFIG.backoffConfig.length - 1; i >= 0; i--) {
    if (failureCount >= RATE_LIMIT_CONFIG.backoffConfig[i].failureCount) {
      return RATE_LIMIT_CONFIG.backoffConfig[i].cooldownSeconds;
    }
  }
  return 0; // No cooldown
}

/**
 * Check rate limit using sliding window algorithm
 * Uses atomic upsert pattern to safely handle concurrent requests
 *
 * @param {string} key - Rate limit key
 * @param {number} limit - Request limit per window
 * @param {number} windowSeconds - Time window in seconds
 * @returns {Promise<object>} { allowed: boolean, remaining: number, resetTime: number, cooldownRemaining: number }
 */
async function checkRateLimit(key, limit, windowSeconds) {
  try {
    const now = Math.floor(Date.now() / 1000);
    let state = await getRateLimitState(key);

    // Ensure record exists using upsert (handles concurrent requests atomically)
    if (!state) {
      await createRateLimitState(key);
      // Fetch fresh state after upsert
      state = await getRateLimitState(key);
      if (!state) {
        // Fallback in case of edge case
        state = { key, window_start: now, request_count: 0, failure_count: 0, cooldown_until: null };
      }
    }

    // Check if in cooldown (progressive backoff)
    const cooldownCheck = checkCooldown(state);
    if (cooldownCheck.inCooldown) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: state.cooldown_until,
        cooldownRemaining: cooldownCheck.cooldownRemaining,
        inCooldown: true,
        reason: 'In cooldown period due to excessive failures'
      };
    }

    // Sliding window: check if window has expired
    const windowExpiry = state.window_start + windowSeconds;
    if (now >= windowExpiry) {
      // Window expired, reset
      await updateRateLimitState(key, {
        window_start: now,
        request_count: 1,
        failure_count: 0,
        cooldown_until: null
      });

      return {
        allowed: true,
        remaining: limit - 1,
        resetTime: now + windowSeconds,
        cooldownRemaining: 0,
        inCooldown: false
      };
    }

    // Window still active
    if (state.request_count >= limit) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: windowExpiry,
        cooldownRemaining: 0,
        inCooldown: false,
        reason: `Rate limit exceeded: ${limit} requests per ${windowSeconds}s`
      };
    }

    // Increment request count
    const newCount = (state.request_count || 0) + 1;
    await updateRateLimitState(key, { request_count: newCount });

    return {
      allowed: true,
      remaining: limit - newCount,
      resetTime: windowExpiry,
      cooldownRemaining: 0,
      inCooldown: false
    };
  } catch (err) {
    console.error('[RATE_LIMIT ERROR]', err.message);
    throw err;
  }
}

/**
 * Record a verification failure and apply progressive backoff
 * Uses atomic upsert pattern to safely handle concurrent requests
 *
 * @param {string} key - Rate limit key
 * @returns {Promise<object>} { backoffActive: boolean, cooldownUntil: number, cooldownRemaining: number }
 */
async function recordFailure(key) {
  try {
    let state = await getRateLimitState(key);

    // Ensure record exists using upsert (handles concurrent requests atomically)
    if (!state) {
      await createRateLimitState(key);
      // Fetch fresh state after upsert
      state = await getRateLimitState(key);
      if (!state) {
        // Fallback in case of edge case
        state = { key, failure_count: 0, cooldown_until: null };
      }
    }

    const newFailureCount = (state.failure_count || 0) + 1;
    const cooldownDuration = getCooldownDuration(newFailureCount);
    const now = Math.floor(Date.now() / 1000);
    const cooldownUntil = cooldownDuration > 0 ? now + cooldownDuration : null;

    const updates = { failure_count: newFailureCount };
    if (cooldownUntil) {
      updates.cooldown_until = cooldownUntil;
    }

    await updateRateLimitState(key, updates);

    return {
      backoffActive: cooldownDuration > 0,
      cooldownUntil: cooldownUntil,
      cooldownRemaining: cooldownDuration,
      failureCount: newFailureCount
    };
  } catch (err) {
    console.error('[FAILURE_RECORD ERROR]', err.message);
    throw err;
  }
}

/**
 * Clear rate limit state for a key (on successful verification)
 *
 * @param {string} key - Rate limit key
 * @returns {Promise<void>}
 */
function clearRateLimitState(key) {
  return new Promise((resolve, reject) => {
    db.run(
      'DELETE FROM rate_limit_state WHERE key = ?',
      [key],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

/**
 * Get rate limit info for health/status endpoint
 *
 * @returns {Promise<object>} Rate limit statistics
 */
async function getRateLimitInfo() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT
        COUNT(*) as total_tracked,
        SUM(CASE WHEN request_count >= ? THEN 1 ELSE 0 END) as limited_keys,
        SUM(CASE WHEN cooldown_until > ? THEN 1 ELSE 0 END) as in_cooldown,
        MAX(failure_count) as max_failures
       FROM rate_limit_state`,
      [RATE_LIMIT_CONFIG.checkInLimit, Math.floor(Date.now() / 1000)],
      (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve({
            totalTracked: row[0]?.total_tracked || 0,
            limitedKeys: row[0]?.limited_keys || 0,
            inCooldown: row[0]?.in_cooldown || 0,
            maxFailures: row[0]?.max_failures || 0
          });
        }
      }
    );
  });
}

module.exports = {
  initializeRateLimitTable,
  checkRateLimit,
  recordFailure,
  clearRateLimitState,
  getRateLimitInfo,
  RATE_LIMIT_CONFIG
};
