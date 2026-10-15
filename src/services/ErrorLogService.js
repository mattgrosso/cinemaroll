/**
 * Unified Error Logging Service for Cinema Roll
 * Provides mobile-friendly error logging with persistence and visibility controls
 */

class ErrorLogService {
  constructor () {
    this.logs = [];
    this.maxLogs = 500; // Limit to prevent memory issues
    this.storageKey = 'cinema_roll_error_logs';
    // Set by the store (setSignedInCheck); this file can't import Firebase.
    this.isSignedIn = null;
    this.loadLogsFromStorage();
  }

  setSignedInCheck (check) {
    this.isSignedIn = check;
  }

  /**
   * Log any type of message with automatic timestamping
   * @param {string} message - The message to log
   * @param {string} level - Log level: 'error', 'warn', 'info', 'debug'
   * @param {object} context - Optional context object for additional data
   */
  log (message, level = 'info', context = {}) {
    const logEntry = {
      id: Date.now() + Math.random(), // Unique ID
      timestamp: new Date().toISOString(),
      message: String(message),
      level,
      context,
      url: window.location.href,
      userAgent: navigator.userAgent.substring(0, 100) // Truncate for storage
    };

    // Add to beginning of array (newest first)
    this.logs.unshift(logEntry);

    // Trim to max size
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }

    // Persist to localStorage
    this.saveLogsToStorage();

    // Also log to console for development
    if (level === 'error') {
      console.error(`[ErrorLog] ${message}`, context);
    } else if (level === 'warn') {
      console.warn(`[ErrorLog] ${message}`, context);
    } else {
      console.log(`[ErrorLog] ${message}`, context);
    }

    return logEntry;
  }

  /**
   * Convenience methods for different log levels
   */
  error (message, context = {}) {
    return this.log(message, 'error', context);
  }

  warn (message, context = {}) {
    return this.log(message, 'warn', context);
  }

  info (message, context = {}) {
    return this.log(message, 'info', context);
  }

  debug (message, context = {}) {
    return this.log(message, 'debug', context);
  }

  /**
   * Get all logs or filter by level
   * @param {string} level - Optional filter by log level
   * @returns {Array} Array of log entries
   */
  getLogs (level = null) {
    if (level) {
      return this.logs.filter(log => log.level === level);
    }
    return [...this.logs]; // Return copy to prevent mutation
  }

  /**
   * Clear all logs
   */
  clearLogs () {
    this.logs = [];
    this.saveLogsToStorage();
  }

  /**
   * Get logs as formatted text for copying
   * @returns {string} Formatted log text
   */
  getLogsAsText () {
    return this.logs.map(log => {
      const time = new Date(log.timestamp).toLocaleString();
      const contextStr = Object.keys(log.context).length > 0
        ? `\nContext: ${JSON.stringify(log.context, null, 2)}`
        : '';
      return `[${time}] ${log.level.toUpperCase()}: ${log.message}${contextStr}`;
    }).join('\n\n');
  }

  /**
   * Save logs to localStorage
   */
  saveLogsToStorage () {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.logs));
    } catch (error) {
      console.warn('Failed to save logs to localStorage:', error);
    }
  }

  /**
   * Load logs from localStorage
   */
  loadLogsFromStorage () {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        this.logs = JSON.parse(stored);
        // Clean up old logs (older than 7 days)
        const weekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        this.logs = this.logs.filter(log => new Date(log.timestamp).getTime() > weekAgo);
      }
    } catch (error) {
      console.warn('Failed to load logs from localStorage:', error);
      this.logs = [];
    }
  }

  /**
   * Get log statistics
   * @returns {object} Statistics about logs
   */
  getStats () {
    const stats = {
      total: this.logs.length,
      errors: this.logs.filter(l => l.level === 'error').length,
      warnings: this.logs.filter(l => l.level === 'warn').length,
      info: this.logs.filter(l => l.level === 'info').length,
      debug: this.logs.filter(l => l.level === 'debug').length
    };

    if (this.logs.length > 0) {
      stats.oldest = this.logs[this.logs.length - 1].timestamp;
      stats.newest = this.logs[0].timestamp;
    }

    return stats;
  }
}

// Create singleton instance
const errorLogService = new ErrorLogService();

// Global error handler to catch unhandled errors
window.addEventListener('error', (event) => {
  errorLogService.error(`Unhandled Error: ${event.message}`, {
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno,
    stack: event.error?.stack
  });
});

// Global unhandled promise rejection handler
// A database refusal with nobody signed in is the expired session the app
// already signs out of (verifyRestoredSession), so any read still missing its
// own catch is a warning, not a Sentry issue (Sentry, 2026-10-15). Refused
// while signed in stays an error: that's a real rules problem.
export function isRefusedWithNoSignIn (reason, isSignedIn) {
  if (!isSignedIn || isSignedIn()) return false;
  return /permission[ _]denied/i.test(String(reason?.message ?? reason ?? ''));
}

window.addEventListener('unhandledrejection', (event) => {
  const level = isRefusedWithNoSignIn(event.reason, errorLogService.isSignedIn) ? 'warn' : 'error';
  errorLogService[level](`Unhandled Promise Rejection: ${event.reason}`, {
    promise: event.promise?.toString(),
    reason: event.reason?.toString(),
    stack: event.reason?.stack
  });
});

export default errorLogService;