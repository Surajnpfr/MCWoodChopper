/**
 * MC Wood Chopper Bot — Multi-Bot Manager
 *
 * This version uses a Web Dashboard to manage multiple bot instances.
 */

const config = require('./config');
const logger = require('./utils/logger');
const { startAPI } = require('./api/server');
const botManager = require('./botManager');

const MODULE = 'Main';

logger.info(MODULE, '─────────────────────────────────────────');
logger.info(MODULE, '  MC Wood Chopper Bot Manager');
logger.info(MODULE, '─────────────────────────────────────────');

// Start the Express Web API and Dashboard
startAPI(config.apiPort || 3001);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  logger.info(MODULE, 'Received SIGTERM, shutting down all bots...');
  botManager.stopAll();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info(MODULE, 'Received SIGINT, shutting down all bots...');
  botManager.stopAll();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error(MODULE, `Unhandled rejection: ${reason}`);
});
