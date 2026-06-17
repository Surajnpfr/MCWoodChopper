const express = require('express');
const logger = require('../utils/logger');
const { getInventorySummary, getInventoryFullness, countLogs, countSaplings } = require('../inventory/inventoryManager');

const MODULE = 'API';

/**
 * Bot statistics tracker.
 */
const stats = {
  treesChopped: 0,
  logsCollected: 0,
  saplingsPlanted: 0,
  itemsDeposited: 0,
  reconnects: 0,
  startedAt: new Date().toISOString(),
  lastActivity: null,
  currentState: 'initializing',
};

/**
 * Start the Express monitoring API.
 *
 * @param {import('mineflayer').Bot} bot - The mineflayer bot instance (can be null initially)
 * @param {number} port - Port to listen on
 * @returns {{ app: express.Application, stats: object, updateBot: Function }}
 */
function startAPI(port) {
  const app = express();
  let botRef = null;

  /**
   * Update the bot reference (needed for reconnects).
   */
  function updateBot(bot) {
    botRef = bot;
  }

  // Health check
  app.get('/', (req, res) => {
    res.json({
      name: 'MC Wood Chopper Bot',
      status: 'running',
      uptime: process.uptime(),
    });
  });

  // Bot status
  app.get('/status', (req, res) => {
    if (!botRef || !botRef.entity) {
      return res.json({
        online: false,
        state: stats.currentState,
        uptime: process.uptime(),
      });
    }

    res.json({
      online: true,
      state: stats.currentState,
      health: botRef.health,
      food: botRef.food,
      position: {
        x: Math.round(botRef.entity.position.x),
        y: Math.round(botRef.entity.position.y),
        z: Math.round(botRef.entity.position.z),
      },
      uptime: process.uptime(),
      lastActivity: stats.lastActivity,
    });
  });

  // Inventory contents
  app.get('/inventory', (req, res) => {
    if (!botRef) {
      return res.json({ error: 'Bot not connected' });
    }

    res.json({
      fullness: getInventoryFullness(botRef) + '%',
      logs: countLogs(botRef),
      saplings: countSaplings(botRef),
      items: getInventorySummary(botRef),
    });
  });

  // Statistics
  app.get('/stats', (req, res) => {
    res.json(stats);
  });

  app.listen(port, () => {
    logger.info(MODULE, `Monitoring API started on port ${port}`);
    logger.info(MODULE, `Endpoints: /status, /inventory, /stats`);
  });

  return { app, stats, updateBot };
}

module.exports = {
  startAPI,
};
