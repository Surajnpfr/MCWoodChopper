const fs = require('fs');
const path = require('path');

const COLORS = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const LEVEL_CONFIG = {
  DEBUG: { color: COLORS.gray, priority: 0 },
  INFO: { color: COLORS.green, priority: 1 },
  WARN: { color: COLORS.yellow, priority: 2 },
  ERROR: { color: COLORS.red, priority: 3 },
};

const LOG_LEVEL = (process.env.LOG_LEVEL || 'INFO').toUpperCase();
const LOG_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const logFile = path.join(LOG_DIR, `bot-${new Date().toISOString().slice(0, 10)}.log`);

function formatTimestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function log(level, module, message, ...args) {
  const config = LEVEL_CONFIG[level];
  if (!config || config.priority < LEVEL_CONFIG[LOG_LEVEL]?.priority) return;

  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level}]`;
  const moduleTag = module ? ` [${module}]` : '';
  const formatted = `${prefix}${moduleTag} ${message}`;

  // Console output with color
  const colored = `${config.color}${prefix}${COLORS.cyan}${moduleTag}${COLORS.reset} ${message}`;
  console.log(colored, ...args);

  // File output (plain text)
  try {
    const fileMsg = args.length > 0
      ? `${formatted} ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')}\n`
      : `${formatted}\n`;
    fs.appendFileSync(logFile, fileMsg);
  } catch {
    // Silently fail file logging
  }
}

module.exports = {
  debug: (module, msg, ...args) => log('DEBUG', module, msg, ...args),
  info: (module, msg, ...args) => log('INFO', module, msg, ...args),
  warn: (module, msg, ...args) => log('WARN', module, msg, ...args),
  error: (module, msg, ...args) => log('ERROR', module, msg, ...args),
};
