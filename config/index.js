const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const defaults = require('./default.json');

/**
 * Configuration loader.
 * Merges default.json values with environment variable overrides.
 */
const config = {
  server: {
    host: process.env.MC_HOST || defaults.server.host,
    port: parseInt(process.env.MC_PORT, 10) || defaults.server.port,
    version: process.env.MC_VERSION || defaults.server.version,
    auth: process.env.MC_AUTH || defaults.server.auth,
  },
  bot: {
    username: process.env.MC_USERNAME || defaults.bot.username,
    password: process.env.MC_PASSWORD || defaults.bot.password,
    serverPassword: process.env.MC_SERVER_PASSWORD || defaults.bot.serverPassword,
  },
  treeRadius: parseInt(process.env.TREE_RADIUS, 10) || defaults.treeRadius,
  collectRadius: parseInt(process.env.COLLECT_RADIUS, 10) || defaults.collectRadius,
  replantEnabled: process.env.REPLANT_ENABLED !== undefined
    ? process.env.REPLANT_ENABLED === 'true'
    : defaults.replantEnabled,
  inventoryThreshold: parseInt(process.env.INVENTORY_THRESHOLD, 10) || defaults.inventoryThreshold,
  autoReconnect: process.env.AUTO_RECONNECT !== undefined
    ? process.env.AUTO_RECONNECT === 'true'
    : defaults.autoReconnect,
  reconnectDelay: parseInt(process.env.RECONNECT_DELAY, 10) || defaults.reconnectDelay,
  maxReconnectAttempts: parseInt(process.env.MAX_RECONNECT_ATTEMPTS, 10) || defaults.maxReconnectAttempts,
  stuckTimeout: defaults.stuckTimeout,
  harvestDelay: defaults.harvestDelay,
  scanInterval: defaults.scanInterval,
  apiPort: parseInt(process.env.API_PORT || process.env.PORT, 10) || defaults.apiPort,
  bedSearchRadius: parseInt(process.env.BED_SEARCH_RADIUS, 10) || 64,
  spawnCheckInterval: parseInt(process.env.SPAWN_CHECK_INTERVAL, 10) || 5, // every N harvest cycles
};

module.exports = Object.freeze(config);
