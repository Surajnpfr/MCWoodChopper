/**
 * MC Wood Chopper Bot — Main Entry Point
 *
 * Autonomous Minecraft bot that detects trees, chops wood,
 * collects drops, replants saplings, and manages inventory.
 */

const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');
const config = require('./config');
const logger = require('./utils/logger');
const { findNearestTree } = require('./harvesting/treeDetector');
const { chopTree } = require('./harvesting/harvester');
const { collectDrops } = require('./harvesting/itemCollector');
const { replantSapling } = require('./planting/planter');
const { isInventoryFull, getInventoryFullness, countLogs, countSaplings, getDepositableItems } = require('./inventory/inventoryManager');
const { findStorageChest, depositItems } = require('./storage/chestManager');
const { startAPI } = require('./api/server');

const MODULE = 'Main';

// ─── Global State ────────────────────────────────────────────────────────────
let bot = null;
let isRunning = false;
let reconnectAttempts = 0;
let api = null;

// ─── Start Monitoring API ────────────────────────────────────────────────────
api = startAPI(config.apiPort);

// ─── Bot Creation ────────────────────────────────────────────────────────────

function createBot() {
  logger.info(MODULE, '─────────────────────────────────────────');
  logger.info(MODULE, '  MC Wood Chopper Bot — Starting Up');
  logger.info(MODULE, '─────────────────────────────────────────');
  logger.info(MODULE, `Server: ${config.server.host}:${config.server.port}`);
  logger.info(MODULE, `Version: ${config.server.version}`);
  logger.info(MODULE, `Username: ${config.bot.username}`);
  logger.info(MODULE, `Auth: ${config.server.auth}`);
  logger.info(MODULE, `Tree radius: ${config.treeRadius}`);
  logger.info(MODULE, `Collect radius: ${config.collectRadius}`);
  logger.info(MODULE, `Replant: ${config.replantEnabled}`);

  const botOptions = {
    host: config.server.host,
    port: config.server.port,
    username: config.bot.username,
    version: config.server.version,
    auth: config.server.auth,
  };

  // Add password for online mode
  if (config.server.auth !== 'offline' && config.bot.password) {
    botOptions.password = config.bot.password;
  }

  bot = mineflayer.createBot(botOptions);

  // Load pathfinder plugin
  bot.loadPlugin(pathfinder);

  // Update API bot reference
  if (api) api.updateBot(bot);

  // ─── Event Handlers ─────────────────────────────────────────────────────

  bot.once('spawn', () => {
    logger.info(MODULE, `Bot spawned at (${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)})`);
    reconnectAttempts = 0;
    api.stats.currentState = 'authenticating';

    // ─── AuthMe Auto-Register/Login ────────────────────────────────────
    const serverPass = config.bot.serverPassword;
    if (serverPass) {
      logger.info(MODULE, 'Attempting server authentication (AuthMe)...');

      let authenticated = false;

      // Safe chat wrapper — bot.chat can fail if not fully ready
      function safeChat(msg) {
        try {
          if (bot && bot.chat) bot.chat(msg);
        } catch (err) {
          logger.debug(MODULE, `Chat not ready yet: ${err.message}`);
        }
      }

      // Listen for server auth prompts
      const authListener = (jsonMsg) => {
        const msg = jsonMsg.toString().toLowerCase();

        if (authenticated) return;

        // Detect success first
        if (msg.includes('successful') || msg.includes('logged in') || msg.includes('already logged') || msg.includes('authenticated')) {
          logger.info(MODULE, '✅ Server authentication successful!');
          authenticated = true;
          bot.removeListener('messagestr', authListener);
          setTimeout(() => startMainLoop(), 3000);
          return;
        }

        // Server asks to register
        if (msg.includes('/register')) {
          logger.info(MODULE, 'Server requests registration, sending /register...');
          setTimeout(() => safeChat(`/register ${serverPass} ${serverPass}`), 500);
        }

        // Server asks to login
        if (msg.includes('/login') || msg.includes('log in')) {
          logger.info(MODULE, 'Server requests login, sending /login...');
          setTimeout(() => safeChat(`/login ${serverPass}`), 500);
        }
      };

      bot.on('messagestr', authListener);

      // Proactively try /login first (most common — already registered)
      setTimeout(() => {
        if (!authenticated) {
          logger.info(MODULE, 'Proactively sending /login...');
          safeChat(`/login ${serverPass}`);
        }
      }, 2000);

      // If login didn't work after 5s, try /register as fallback
      setTimeout(() => {
        if (!authenticated) {
          logger.info(MODULE, 'Login not confirmed, trying /register...');
          safeChat(`/register ${serverPass} ${serverPass}`);
        }
      }, 5000);

      // Fallback: if no auth response after 15s, start anyway
      setTimeout(() => {
        if (!authenticated) {
          logger.warn(MODULE, 'No auth response after 15s — starting main loop anyway (server may not use AuthMe)');
          authenticated = true;
          bot.removeListener('messagestr', authListener);
          startMainLoop();
        }
      }, 15000);

    } else {
      // No server password configured, start directly
      api.stats.currentState = 'idle';
      setTimeout(() => startMainLoop(), 3000);
    }
  });

  bot.on('health', () => {
    if (bot.health <= 5) {
      logger.warn(MODULE, `Low health: ${bot.health} HP`);
    }
  });

  // ─── Teleport Detection ────────────────────────────────────────────────
  let lastKnownPos = null;

  bot.on('move', () => {
    if (!bot.entity) return;
    const pos = bot.entity.position;

    if (lastKnownPos) {
      const dist = pos.distanceTo(lastKnownPos);
      // If moved more than 10 blocks in one tick, it's a teleport
      if (dist > 10) {
        logger.info(MODULE, `📍 Teleported to (${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}) — restarting scan`);

        // Stop current loop so it restarts from new location
        isRunning = false;
        bot.pathfinder.stop();
        api.stats.currentState = 'teleported';

        // Wait for chunks to load, then restart
        setTimeout(() => {
          startMainLoop();
        }, 2000);
      }
    }

    lastKnownPos = pos.clone();
  });

  bot.on('death', () => {
    logger.warn(MODULE, 'Bot died! Waiting for respawn...');
    api.stats.currentState = 'dead';
    isRunning = false;

    // Auto respawn
    bot.once('spawn', () => {
      logger.info(MODULE, 'Bot respawned, resuming operations...');
      setTimeout(() => startMainLoop(), 5000);
    });
  });

  bot.on('kicked', (reason) => {
    logger.error(MODULE, `Bot was kicked: ${reason}`);
    isRunning = false;
    api.stats.currentState = 'kicked';
    handleReconnect();
  });

  bot.on('error', (err) => {
    logger.error(MODULE, `Bot error: ${err.message}`);
  });

  bot.on('end', (reason) => {
    logger.warn(MODULE, `Bot disconnected: ${reason}`);
    isRunning = false;
    api.stats.currentState = 'disconnected';
    handleReconnect();
  });

  // Chat commands for remote control
  bot.on('chat', (username, message) => {
    if (username === bot.username) return;

    switch (message.trim().toLowerCase()) {
      case '!status':
        bot.chat(`[WoodBot] HP: ${bot.health} | Logs: ${countLogs(bot)} | Saplings: ${countSaplings(bot)} | Inv: ${getInventoryFullness(bot)}%`);
        break;
      case '!stop':
        bot.chat('[WoodBot] Stopping...');
        isRunning = false;
        api.stats.currentState = 'stopped';
        break;
      case '!start':
        bot.chat('[WoodBot] Starting...');
        startMainLoop();
        break;
      case '!fill':
        bot.chat('[WoodBot] Filling nearest chest with logs...');
        (async () => {
          const chestPos = findStorageChest(bot, config.treeRadius);
          if (!chestPos) {
            bot.chat('[WoodBot] No chest found nearby!');
            return;
          }
          const deposited = await depositItems(bot, chestPos);
          bot.chat(`[WoodBot] Done! Deposited ${deposited} item types into chest.`);
        })();
        break;
      case '!give':
        bot.chat('[WoodBot] Finding nearest player to give wood...');
        (async () => {
          // Find nearest player
          const playerFilter = (entity) => entity.type === 'player';
          const player = bot.nearestEntity(playerFilter);
          
          if (!player) {
            bot.chat('[WoodBot] No players found nearby!');
            return;
          }
          
          bot.chat(`[WoodBot] Coming to ${player.username}...`);
          const { goTo } = require('./navigation/navigator');
          
          // Walk to player
          await goTo(bot, player.position, 5000);
          
          // Face player
          await bot.lookAt(player.position.offset(0, 1.6, 0));
          
          // Toss items
          const itemsToGive = getDepositableItems(bot);
          let given = 0;
          for (const item of itemsToGive) {
            try {
              // bot.toss takes (itemType, metadata, count)
              await bot.toss(item.type, item.metadata, item.count);
              given += item.count;
              await new Promise(resolve => setTimeout(resolve, 200));
            } catch (err) {
              logger.warn(MODULE, `Failed to toss ${item.name}: ${err.message}`);
            }
          }
          bot.chat(`[WoodBot] Tossed ${given} items!`);
        })();
        break;
      case '!stats':
        bot.chat(`[WoodBot] Trees: ${api.stats.treesChopped} | Planted: ${api.stats.saplingsPlanted}`);
        break;
      case '!help':
        bot.chat('[WoodBot] Commands: !status !start !stop !fill !give !stats !help');
        break;
    }
  });

  return bot;
}

// ─── Auto Reconnect ──────────────────────────────────────────────────────────

function handleReconnect() {
  if (!config.autoReconnect) {
    logger.info(MODULE, 'Auto-reconnect disabled, not reconnecting');
    return;
  }

  if (reconnectAttempts >= config.maxReconnectAttempts) {
    logger.error(MODULE, `Max reconnect attempts (${config.maxReconnectAttempts}) reached, giving up`);
    return;
  }

  reconnectAttempts++;
  const delay = config.reconnectDelay * Math.min(reconnectAttempts, 5); // Exponential-ish backoff

  logger.info(MODULE, `Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${config.maxReconnectAttempts})...`);
  api.stats.currentState = 'reconnecting';
  api.stats.reconnects++;

  setTimeout(() => {
    createBot();
  }, delay);
}

// ─── Main Bot Loop ───────────────────────────────────────────────────────────

async function startMainLoop() {
  if (isRunning) {
    logger.debug(MODULE, 'Main loop already running');
    return;
  }

  isRunning = true;
  logger.info(MODULE, '🪓 Starting autonomous wood chopping loop');

  while (isRunning) {
    try {
      // ── Step 1: Check inventory ─────────────────────────────────────────
      if (isInventoryFull(bot, config.inventoryThreshold)) {
        api.stats.currentState = 'depositing';
        logger.info(MODULE, `Inventory at ${getInventoryFullness(bot)}%, looking for storage chest...`);

        const chestPos = findStorageChest(bot, config.treeRadius);
        if (chestPos) {
          const deposited = await depositItems(bot, chestPos);
          api.stats.itemsDeposited += deposited;
        } else {
          logger.warn(MODULE, 'No storage chest found! Place a chest with a wooden item frame nearby.');
          // Wait before retrying to avoid spam
          await sleep(10000);
          continue;
        }
      }

      // ── Step 2: Scan for trees ──────────────────────────────────────────
      api.stats.currentState = 'scanning';
      logger.debug(MODULE, `Scanning for trees within ${config.treeRadius} block radius...`);

      const tree = findNearestTree(bot, config.treeRadius);

      if (!tree) {
        api.stats.currentState = 'waiting';
        logger.debug(MODULE, 'No trees found, waiting...');
        await sleep(config.scanInterval);
        continue;
      }

      // ── Step 3: Chop the tree ───────────────────────────────────────────
      api.stats.currentState = 'chopping';
      const logsChopped = await chopTree(bot, tree);

      if (logsChopped > 0) {
        api.stats.treesChopped++;
        api.stats.logsCollected += logsChopped;
        api.stats.lastActivity = new Date().toISOString();
      }

      // ── Step 4: Collect drops ───────────────────────────────────────────
      api.stats.currentState = 'collecting';
      await collectDrops(bot, config.collectRadius);

      // ── Step 5: Replant sapling ─────────────────────────────────────────
      if (config.replantEnabled) {
        api.stats.currentState = 'planting';
        const planted = await replantSapling(bot, tree.position, tree.logType);
        if (planted) {
          api.stats.saplingsPlanted++;
        }
      }

      // Small delay between cycles
      await sleep(1000);

    } catch (err) {
      logger.error(MODULE, `Error in main loop: ${err.message}`);
      logger.error(MODULE, err.stack);
      await sleep(5000); // Wait before retrying after error
    }
  }

  logger.info(MODULE, 'Main loop stopped');
  api.stats.currentState = 'stopped';
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

// ─── Graceful Shutdown ───────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  logger.info(MODULE, 'Received SIGTERM, shutting down...');
  isRunning = false;
  if (bot) bot.end();
  process.exit(0);
});

// Prevent unhandled rejections from crashing the process
process.on('unhandledRejection', (reason) => {
  logger.error(MODULE, `Unhandled rejection: ${reason}`);
});

// ─── Terminal CLI ────────────────────────────────────────────────────────────

const readline = require('readline');

function startCLI() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  logger.info(MODULE, '─────────────────────────────────────────');
  logger.info(MODULE, '  Terminal Commands Available:');
  logger.info(MODULE, '  status    — Bot health, position, state');
  logger.info(MODULE, '  start     — Start/resume the bot loop');
  logger.info(MODULE, '  stop      — Pause the bot loop');
  logger.info(MODULE, '  stats     — Trees chopped, saplings planted');
  logger.info(MODULE, '  inventory — Show inventory contents');
  logger.info(MODULE, '  say <msg> — Send chat message in-game');
  logger.info(MODULE, '  pos       — Show bot position');
  logger.info(MODULE, '  help      — Show this help');
  logger.info(MODULE, '  quit      — Shut down the bot');
  logger.info(MODULE, '─────────────────────────────────────────');

  rl.on('line', (input) => {
    const line = input.trim();
    if (!line) return;

    const [cmd, ...args] = line.split(' ');

    switch (cmd.toLowerCase()) {
      case 'status':
        if (!bot || !bot.entity) {
          console.log('  Bot is not connected.');
        } else {
          console.log(`  State:    ${api.stats.currentState}`);
          console.log(`  Health:   ${bot.health} HP`);
          console.log(`  Food:     ${bot.food}`);
          console.log(`  Position: (${Math.round(bot.entity.position.x)}, ${Math.round(bot.entity.position.y)}, ${Math.round(bot.entity.position.z)})`);
          console.log(`  Inventory: ${getInventoryFullness(bot)}% full`);
          console.log(`  Logs: ${countLogs(bot)} | Saplings: ${countSaplings(bot)}`);
        }
        break;

      case 'start':
        console.log('  Starting bot loop...');
        startMainLoop();
        break;

      case 'stop':
        isRunning = false;
        api.stats.currentState = 'stopped';
        console.log('  Bot loop stopped.');
        break;

      case 'fill':
        console.log('  Filling nearest chest with logs...');
        (async () => {
          if (!bot) return console.log('  Bot is not connected.');
          const chestPos = require('./storage/chestManager').findStorageChest(bot, config.treeRadius);
          if (!chestPos) {
            console.log('  No chest found nearby!');
            return;
          }
          const deposited = await require('./storage/chestManager').depositItems(bot, chestPos);
          console.log(`  Done! Deposited ${deposited} item types into chest.`);
        })();
        break;

      case 'stats':
        console.log(`  Trees chopped:    ${api.stats.treesChopped}`);
        console.log(`  Logs collected:   ${api.stats.logsCollected}`);
        console.log(`  Saplings planted: ${api.stats.saplingsPlanted}`);
        console.log(`  Items deposited:  ${api.stats.itemsDeposited}`);
        console.log(`  Reconnects:       ${api.stats.reconnects}`);
        console.log(`  Running since:    ${api.stats.startedAt}`);
        break;

      case 'inventory':
      case 'inv':
        if (!bot) {
          console.log('  Bot is not connected.');
        } else {
          const summary = require('./inventory/inventoryManager').getInventorySummary(bot);
          console.log(`  Inventory (${getInventoryFullness(bot)}% full):`);
          for (const [name, count] of Object.entries(summary)) {
            console.log(`    ${name}: ${count}`);
          }
          if (Object.keys(summary).length === 0) {
            console.log('    (empty)');
          }
        }
        break;

      case 'say':
      case 'chat':
        if (!bot) {
          console.log('  Bot is not connected.');
        } else {
          const msg = args.join(' ');
          if (msg) {
            bot.chat(msg);
            console.log(`  Sent: ${msg}`);
          } else {
            console.log('  Usage: say <message>');
          }
        }
        break;

      case 'pos':
        if (!bot || !bot.entity) {
          console.log('  Bot is not connected.');
        } else {
          const p = bot.entity.position;
          console.log(`  Position: (${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`);
        }
        break;

      case 'help':
        console.log('  status    — Bot health, position, state');
        console.log('  start     — Start/resume the bot loop');
        console.log('  stop      — Pause the bot loop');
        console.log('  fill      — Fill nearest chest with logs');
        console.log('  stats     — Trees chopped, saplings planted');
        console.log('  inventory — Show inventory contents');
        console.log('  say <msg> — Send chat message in-game');
        console.log('  pos       — Show bot position');
        console.log('  help      — Show this help');
        console.log('  quit      — Shut down the bot');
        break;

      case 'quit':
      case 'exit':
        logger.info(MODULE, 'Shutting down from terminal...');
        isRunning = false;
        if (bot) {
          bot.chat('[WoodBot] Shutting down. Goodbye!');
          setTimeout(() => {
            bot.end();
            process.exit(0);
          }, 1000);
        } else {
          process.exit(0);
        }
        break;

      default:
        // Anything else — send as chat message
        if (bot) {
          bot.chat(line);
          console.log(`  Sent: ${line}`);
        } else {
          console.log(`  Unknown command: ${cmd}. Type "help" for available commands.`);
        }
        break;
    }
  });

  // Handle Ctrl+C via readline instead of raw SIGINT
  rl.on('close', () => {
    logger.info(MODULE, 'Terminal closed, shutting down...');
    isRunning = false;
    if (bot) bot.end();
    process.exit(0);
  });
}

// ─── Start ───────────────────────────────────────────────────────────────────
createBot();
startCLI();
