const fs = require('fs');
const path = require('path');

/**
 * Simple production logger that writes to files and console
 * No external dependencies - uses Node.js built-in fs module
 */

const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, '../logs');
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE_MAX_SIZE = parseFileSize(process.env.LOG_FILE_MAX_SIZE || '10M');
const LOG_FILE_MAX_FILES = parseInt(process.env.LOG_FILE_MAX_FILES || '14');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

const currentLogLevel = LOG_LEVELS[LOG_LEVEL] || LOG_LEVELS.info;

/**
 * Parse file size strings (10M, 100K, etc.)
 */
function parseFileSize(sizeStr) {
  const units = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
  const match = sizeStr.match(/^(\d+)([KMG])?$/);
  if (!match) return 10 * 1024 * 1024; // Default 10M
  const value = parseInt(match[1]);
  const unit = match[2] || 'B';
  return value * (units[unit] || 1);
}

/**
 * Get current log file path
 */
function getLogFilePath(type = 'app') {
  return path.join(LOG_DIR, `${type}-${new Date().toISOString().split('T')[0]}.log`);
}

/**
 * Rotate log file if size exceeded
 */
function rotateLogFile(logPath) {
  try {
    if (!fs.existsSync(logPath)) return;
    const stats = fs.statSync(logPath);
    if (stats.size > LOG_FILE_MAX_SIZE) {
      const dir = path.dirname(logPath);
      const basename = path.basename(logPath, '.log');
      const timestamp = new Date().getTime();
      const archivedPath = path.join(dir, `${basename}-${timestamp}.log`);
      fs.renameSync(logPath, archivedPath);
      cleanOldLogs(dir, basename);
    }
  } catch (err) {
    console.error('Log rotation failed:', err.message);
  }
}

/**
 * Clean old log files, keeping only MAX_FILES
 */
function cleanOldLogs(logDir, pattern) {
  try {
    const files = fs
      .readdirSync(logDir)
      .filter(f => f.includes(pattern))
      .map(f => ({
        name: f,
        path: path.join(logDir, f),
        time: fs.statSync(path.join(logDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    if (files.length > LOG_FILE_MAX_FILES) {
      files.slice(LOG_FILE_MAX_FILES).forEach(file => {
        fs.unlinkSync(file.path);
      });
    }
  } catch (err) {
    console.error('Log cleanup failed:', err.message);
  }
}

/**
 * Format log entry
 */
function formatLogEntry(level, message, meta = {}) {
  const timestamp = new Date().toISOString();
  const safeMeta = meta && typeof meta === 'object' ? meta : {};
  const metaStr = Object.keys(safeMeta).length > 0 ? ` | ${JSON.stringify(safeMeta)}` : '';
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${metaStr}`;
}

/**
 * Write to log file
 */
function writeToFile(type, level, message, meta) {
  try {
    const logPath = getLogFilePath(type);
    rotateLogFile(logPath);
    const entry = formatLogEntry(level, message, meta) + '\n';
    fs.appendFileSync(logPath, entry);
  } catch (err) {
    console.error('Failed to write log:', err.message);
  }
}

/**
 * Main logger object
 */
const logger = {
  error(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.error) {
      console.error(formatLogEntry('error', message, meta));
      writeToFile('app', 'error', message, meta);
    }
  },

  warn(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.warn) {
      console.warn(formatLogEntry('warn', message, meta));
      writeToFile('app', 'warn', message, meta);
    }
  },

  info(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.info) {
      console.log(formatLogEntry('info', message, meta));
      writeToFile('app', 'info', message, meta);
    }
  },

  debug(message, meta = {}) {
    if (currentLogLevel >= LOG_LEVELS.debug) {
      console.log(formatLogEntry('debug', message, meta));
      writeToFile('app', 'debug', message, meta);
    }
  },

  /**
   * Log HTTP request
   */
  logRequest(req, res, responseTime) {
    if (process.env.LOG_REQUESTS !== 'false') {
      const meta = {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        responseTime: `${responseTime}ms`,
        memberId: req.headers['x-member-id'] || 'anonymous',
        ip: req.ip || req.connection.remoteAddress
      };
      if (process.env.LOG_REQUEST_BODY === 'true' && Object.keys(req.body).length > 0) {
        meta.body = req.body;
      }
      writeToFile('requests', 'info', `${req.method} ${req.path}`, meta);
    }
  },

  /**
   * Get log file paths
   */
  getLogFiles() {
    try {
      return fs.readdirSync(LOG_DIR).map(f => path.join(LOG_DIR, f));
    } catch (err) {
      return [];
    }
  }
};

module.exports = logger;
