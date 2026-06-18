const express = require('express');
const path = require('path');
const logger = require('../utils/logger');
const botManager = require('../botManager');
const config = require('../config');

const MODULE = 'API';

function startAPI(port) {
  const app = express();

  // Middleware
  app.use(express.json());
  
  // Serve static UI files
  app.use(express.static(path.join(__dirname, '../public')));

  // Bot endpoints
  app.get('/api/bots', (req, res) => {
    res.json(botManager.getAllStatus());
  });

  app.post('/api/bots/launch', (req, res) => {
    const { count = 1, baseName = 'WoodBot', serverIp = 'localhost', serverPassword = '' } = req.body;
    logger.info(MODULE, `API Request: Launching ${count} bots on ${serverIp} with base name ${baseName}`);
    const bots = botManager.launchBots(count, baseName, serverIp, serverPassword);
    res.json({ success: true, bots });
  });

  app.post('/api/bots/stop/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const success = botManager.stopBot(id);
    res.json({ success });
  });

  app.post('/api/bots/stop-all', (req, res) => {
    botManager.stopAll();
    res.json({ success: true });
  });

  app.get('/api/config', (req, res) => {
    // Return safe config values (hide passwords)
    const safeConfig = { ...config };
    if (safeConfig.bot) safeConfig.bot.password = '***';
    if (safeConfig.bot) safeConfig.bot.serverPassword = '***';
    res.json(safeConfig);
  });

  app.listen(port, () => {
    logger.info(MODULE, `Web UI and API started on port ${port}`);
    logger.info(MODULE, `Dashboard available at http://localhost:${port}`);
  });

  return app;
}

module.exports = {
  startAPI,
};
