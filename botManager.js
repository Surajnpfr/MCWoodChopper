const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const config = require('./config');
const logger = require('./utils/logger');
const { findNearestTree } = require('./harvesting/treeDetector');
const { setSpawnToNearestBed } = require('./spawning/spawnManager');
const { chopTree } = require('./harvesting/harvester');
const { collectDrops } = require('./harvesting/itemCollector');
const { replantSapling } = require('./planting/planter');
const { isInventoryFull, getInventoryFullness, countLogs, countSaplings, getDepositableItems, getInventorySummary } = require('./inventory/inventoryManager');
const { findStorageChest, depositItems } = require('./storage/chestManager');
const { goTo } = require('./navigation/navigator');
const { registerCommands } = require('./commands/commandHandler');
const { checkAndEat, eatUntilFull } = require('./survival/foodManager');

const MODULE = 'BotManager';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class WoodBot {
  constructor(options, id, deferConnect = false) {
    this.id = id;
    this.options = options;
    this.bot = null;
    this.isRunning = false;
    this.reconnectAttempts = 0;
    
    this.stats = {
      treesChopped: 0,
      logsCollected: 0,
      saplingsPlanted: 0,
      itemsDeposited: 0,
      reconnects: 0,
      startedAt: new Date().toISOString(),
      lastActivity: null,
      currentState: 'initializing',
    };

    if (!deferConnect) {
      this.connect();
    }
  }

  connect() {
    logger.info(MODULE, `Starting bot ${this.options.username}...`);
    this.bot = mineflayer.createBot(this.options);
    this.bot.loadPlugin(pathfinder);

    this.setupEvents();
  }

  setupEvents() {
    this.bot.once('spawn', () => {
      logger.info(MODULE, `${this.options.username} spawned.`);
      this.reconnectAttempts = 0;
      this.stats.currentState = 'authenticating';

      // Register in-game chat commands (!fill, !bed, !follow, etc.)
      registerCommands(this, config);
      // ─── AuthMe Auto-Register/Login ────────────────────────────────────
      const serverPass = this.options.serverPassword || config.bot.serverPassword;
      if (serverPass && config.server.auth === 'offline') {
        let authenticated = false;
        const safeChat = (msg) => {
          try {
            if (this.bot && this.bot.chat) this.bot.chat(msg);
          } catch (err) {}
        };

        const authListener = (jsonMsg) => {
          if (authenticated) return;
          const msg = jsonMsg.toString().toLowerCase();
          
          if (msg.includes('successful') || msg.includes('logged in') || msg.includes('already logged') || msg.includes('authenticated')) {
            authenticated = true;
            this.bot.removeListener('messagestr', authListener);
            setTimeout(() => this.startLoop(), 3000);
            return;
          }
          if (msg.includes('/register')) setTimeout(() => safeChat(`/register ${serverPass} ${serverPass}`), 500);
          if (msg.includes('/login') || msg.includes('log in')) setTimeout(() => safeChat(`/login ${serverPass}`), 500);
        };

        this.bot.on('messagestr', authListener);
        setTimeout(() => { if (!authenticated) safeChat(`/login ${serverPass}`); }, 2000);
        setTimeout(() => { if (!authenticated) safeChat(`/register ${serverPass} ${serverPass}`); }, 5000);
        setTimeout(() => {
          if (!authenticated) {
            authenticated = true;
            this.bot.removeListener('messagestr', authListener);
            this.startLoop();
          }
        }, 15000);
      } else {
        this.stats.currentState = 'idle';
        setTimeout(() => this.startLoop(), 3000);
      }
    });

    let lastKnownPos = null;
    this.bot.on('move', () => {
      if (!this.bot.entity) return;
      const pos = this.bot.entity.position;
      if (lastKnownPos) {
        // Raise threshold from 10 → 15 to avoid false triggers during pillar-up jumps
        if (pos.distanceTo(lastKnownPos) > 15) {
          logger.info(MODULE, `${this.options.username} teleported, restarting scan.`);
          this.isRunning = false;
          this.bot.pathfinder.stop();
          this.stats.currentState = 'teleported';
          setTimeout(() => this.startLoop(), 2000);
        }
      }
      lastKnownPos = pos.clone();
    });

    this.bot.on('death', () => {
      this.stats.currentState = 'dead';
      this.isRunning = false;
      this.bot.once('spawn', () => {
        setTimeout(() => this.startLoop(), 5000);
      });
    });

    this.bot.on('kicked', (reason) => {
      logger.error(MODULE, `${this.options.username} kicked: ${reason}`);
      this.isRunning = false;
      this.stats.currentState = 'kicked';
      this.handleReconnect();
    });

    this.bot.on('error', (err) => {
      logger.error(MODULE, `${this.options.username} error: ${err.message}`);
    });

    this.bot.on('end', (reason) => {
      logger.warn(MODULE, `${this.options.username} disconnected: ${reason}`);
      this.isRunning = false;
      this.stats.currentState = 'disconnected';
      this.handleReconnect();
    });
  }

  handleReconnect() {
    if (!config.autoReconnect) return;
    if (this.reconnectAttempts >= config.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = config.reconnectDelay * Math.min(this.reconnectAttempts, 5);
    this.stats.currentState = 'reconnecting';
    this.stats.reconnects++;
    setTimeout(() => this.connect(), delay);
  }

  async startLoop() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._harvestCycles = 0; // counter for spawn-set throttling
    logger.info(MODULE, `${this.options.username} starting autonomous loop.`);

    while (this.isRunning && this.bot && this.bot.entity) {
      try {
        // ─── Hunger check: eat food or ask for it ─────────────────────────
        if (this.bot.food < 5) {
          this.stats.currentState = 'eating';
          await eatUntilFull(this.bot);
        }

        if (isInventoryFull(this.bot, config.inventoryThreshold)) {
          this.stats.currentState = 'depositing';
          const chestPos = findStorageChest(this.bot, config.treeRadius);
          if (chestPos) {
            const deposited = await depositItems(this.bot, chestPos);
            this.stats.itemsDeposited += deposited;
          } else {
            await sleep(10000);
            continue;
          }
        }

        this.stats.currentState = 'scanning';
        const tree = findNearestTree(this.bot, config.treeRadius);
        if (!tree) {
          this.stats.currentState = 'waiting';
          await sleep(config.scanInterval);
          continue;
        }

        this.stats.currentState = 'chopping';
        const logsChopped = await chopTree(this.bot, tree);
        if (logsChopped > 0) {
          this.stats.treesChopped++;
          this.stats.logsCollected += logsChopped;
          this.stats.lastActivity = new Date().toISOString();
        }

        this.stats.currentState = 'collecting';
        await collectDrops(this.bot, config.collectRadius);

        if (config.replantEnabled) {
          this.stats.currentState = 'planting';
          const planted = await replantSapling(this.bot, tree.position, tree.logType);
          if (planted) this.stats.saplingsPlanted++;
        }

        // Set spawn point every N harvest cycles (avoids navigating to bed every single time)
        this._harvestCycles = (this._harvestCycles || 0) + 1;
        if (this._harvestCycles % (config.spawnCheckInterval || 5) === 1) {
          this.stats.currentState = 'setting_spawn';
          await setSpawnToNearestBed(this.bot, config.bedSearchRadius || 64);
        }

        this.stats.currentState = 'idle';
        await sleep(1000);
      } catch (err) {
        logger.error(MODULE, `${this.options.username} loop error: ${err.message}`);
        await sleep(5000);
      }
    }
    this.isRunning = false;
    this.stats.currentState = 'stopped';
  }

  stop() {
    this.isRunning = false;
    if (this.bot) this.bot.quit();
  }

  getStatus() {
    const hasAxe = this.bot && this.bot.entity ? this.bot.inventory.items().some(item => item.name.includes('_axe')) : false;
    return {
      id: this.id,
      username: this.options.username,
      online: !!(this.bot && this.bot.entity),
      state: this.stats.currentState,
      health: this.bot && this.bot.entity ? this.bot.health : 0,
      food: this.bot && this.bot.entity ? this.bot.food : 0,
      inventoryFullness: this.bot && this.bot.entity ? getInventoryFullness(this.bot) : 0,
      logs: this.bot && this.bot.entity ? countLogs(this.bot) : 0,
      hasAxe: hasAxe,
      stats: this.stats
    };
  }
}

class BotManager {
  constructor() {
    this.bots = new Map();
    this.nextId = 1;
  }

  launchBots(count, baseName, serverIp, serverPassword = '') {
    const [host, port] = serverIp.split(':');
    
    const newBots = [];
    for (let i = 0; i < count; i++) {
      const username = count === 1 ? baseName : `${baseName}_${i+1}`;
      const options = {
        host: host || config.server.host,
        port: parseInt(port) || config.server.port,
        username: username,
        version: config.server.version,
        auth: config.server.auth,
        serverPassword: serverPassword, // Passed to WoodBot for AuthMe
      };
      
      if (config.server.auth !== 'offline' && config.bot.password) {
        options.password = config.bot.password;
      }
      
      const id = this.nextId++;
      // Create bot but defer connection
      const bot = new WoodBot(options, id, true);
      this.bots.set(id, bot);
      newBots.push(bot);
    }

    // Stagger connections in the background
    this._staggerConnect(newBots);

    return Array.from(this.bots.values()).map(b => b.getStatus());
  }

  async _staggerConnect(bots) {
    for (const bot of bots) {
      // Connect bot
      bot.connect();
      // Wait 8 s before connecting the next one — avoids "Connection throttled" kicks
      await sleep(8000);
    }
  }

  stopBot(id) {
    const bot = this.bots.get(id);
    if (bot) {
      bot.stop();
      this.bots.delete(id);
      return true;
    }
    return false;
  }

  stopAll() {
    for (const bot of this.bots.values()) {
      bot.stop();
    }
    this.bots.clear();
  }

  getAllStatus() {
    return Array.from(this.bots.values()).map(b => b.getStatus());
  }
}

module.exports = new BotManager();
