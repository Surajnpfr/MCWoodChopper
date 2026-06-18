/**
 * commands/commandHandler.js
 * 
 * In-game chat command handler for MCWoodChopper bots.
 * 
 * Commands (sent in public chat):
 *   !fill        — deposit inventory into nearest chest immediately
 *   !bed         — right-click nearest bed to set spawn point
 *   !follow      — follow the player who typed the command
 *   !stopfollow  — stop following
 *   !stop        — pause autonomous chopping loop
 *   !start       — resume autonomous chopping loop
 *   !status      — bot replies with its current state in chat
 */

const { findStorageChest, depositItems } = require('../storage/chestManager');
const { setSpawnToNearestBed } = require('../spawning/spawnManager');
const { eatUntilFull } = require('../survival/foodManager');
const { goals, Movements } = require('mineflayer-pathfinder');
const logger = require('../utils/logger');

const MODULE = 'CommandHandler';

/**
 * Register chat command listeners on a WoodBot instance.
 * @param {object} woodBot - The WoodBot class instance (has .bot, .isRunning, .startLoop, .stats)
 * @param {object} config   - The global config object
 */
function registerCommands(woodBot, config) {
  let followInterval = null; // Interval handle for follow loop

  woodBot.bot.on('chat', async (username, message) => {
    // Ignore messages from the bot itself
    if (username === woodBot.options.username) return;

    const cmd = message.trim().toLowerCase();

    // ─── !fill ───────────────────────────────────────────────────────────────
    if (cmd === '!fill') {
      logger.info(MODULE, `${username} triggered !fill`);
      woodBot.bot.chat(`Depositing items into nearest chest...`);

      const chestPos = findStorageChest(woodBot.bot, config.treeRadius);
      if (!chestPos) {
        woodBot.bot.chat(`No chest found within ${config.treeRadius} blocks!`);
        return;
      }

      try {
        const count = await depositItems(woodBot.bot, chestPos);
        woodBot.bot.chat(`Deposited ${count} items into chest at ${fmt(chestPos)}.`);
        logger.info(MODULE, `!fill: deposited ${count} items`);
      } catch (err) {
        woodBot.bot.chat(`Failed to deposit: ${err.message}`);
        logger.warn(MODULE, `!fill error: ${err.message}`);
      }
    }

    // ─── !bed ─────────────────────────────────────────────────────────────────
    else if (cmd === '!bed') {
      logger.info(MODULE, `${username} triggered !bed`);
      woodBot.bot.chat(`Looking for nearest bed...`);

      try {
        const success = await setSpawnToNearestBed(woodBot.bot, config.bedSearchRadius || 64);
        if (success) {
          woodBot.bot.chat(`Spawn point set!`);
        } else {
          woodBot.bot.chat(`No bed found within ${config.bedSearchRadius || 64} blocks!`);
        }
      } catch (err) {
        woodBot.bot.chat(`Bed error: ${err.message}`);
        logger.warn(MODULE, `!bed error: ${err.message}`);
      }
    }

    // ─── !follow ──────────────────────────────────────────────────────────────
    else if (cmd === '!follow') {
      logger.info(MODULE, `${username} triggered !follow`);

      // Stop autonomous loop so it doesn't interfere with following
      woodBot.isRunning = false;
      woodBot.bot.pathfinder.stop();
      woodBot.stats.currentState = 'following';
      woodBot.bot.chat(`Now following ${username}!`);

      // Clear any existing follow interval
      if (followInterval) clearInterval(followInterval);

      const mcData = require('minecraft-data')(woodBot.bot.version);
      const movements = new Movements(woodBot.bot, mcData);
      movements.allowSprinting = true;
      movements.canDig = false; // Don't dig while following
      woodBot.bot.pathfinder.setMovements(movements);

      // Follow by continuously updating the pathfinder goal toward the target player
      followInterval = setInterval(() => {
        const target = woodBot.bot.players[username];
        if (!target || !target.entity) {
          // Player out of range — wait, don't crash
          return;
        }
        const goal = new goals.GoalFollow(target.entity, 2); // stay 2 blocks away
        woodBot.bot.pathfinder.setGoal(goal, true); // dynamic = true
      }, 1000);
    }

    // ─── !stopfollow ─────────────────────────────────────────────────────────
    else if (cmd === '!stopfollow') {
      logger.info(MODULE, `${username} triggered !stopfollow`);

      if (followInterval) {
        clearInterval(followInterval);
        followInterval = null;
      }
      woodBot.bot.pathfinder.stop();
      woodBot.stats.currentState = 'idle';
      woodBot.bot.chat(`Stopped following. Type !start to resume chopping.`);
    }

    // ─── !stop ────────────────────────────────────────────────────────────────
    else if (cmd === '!stop') {
      logger.info(MODULE, `${username} triggered !stop`);

      // Stop follow loop if active
      if (followInterval) {
        clearInterval(followInterval);
        followInterval = null;
      }

      woodBot.isRunning = false;
      woodBot.bot.pathfinder.stop();
      woodBot.stats.currentState = 'stopped';
      woodBot.bot.chat(`Chopping stopped. Type !start to resume.`);
    }

    // ─── !start ───────────────────────────────────────────────────────────────
    else if (cmd === '!start') {
      logger.info(MODULE, `${username} triggered !start`);

      // Stop follow loop if active
      if (followInterval) {
        clearInterval(followInterval);
        followInterval = null;
      }

      if (!woodBot.isRunning) {
        woodBot.bot.chat(`Resuming autonomous chopping!`);
        woodBot.startLoop();
      } else {
        woodBot.bot.chat(`Already chopping!`);
      }
    }

    // ─── !status ──────────────────────────────────────────────────────────────
    else if (cmd === '!status') {
      const s = woodBot.stats;
      const hunger = woodBot.bot.food || 0;
      woodBot.bot.chat(
        `[${woodBot.options.username}] State: ${s.currentState} | Trees: ${s.treesChopped} | Logs: ${s.logsCollected} | Hunger: ${hunger}/20`
      );
    }

    // ─── !eat ─────────────────────────────────────────────────────────────────
    else if (cmd === '!eat') {
      logger.info(MODULE, `${username} triggered !eat`);
      woodBot.bot.chat(`Eating... (hunger: ${woodBot.bot.food}/20)`);
      try {
        await eatUntilFull(woodBot.bot);
        woodBot.bot.chat(`Done eating! Hunger now: ${woodBot.bot.food}/20`);
      } catch (err) {
        woodBot.bot.chat(`Eat failed: ${err.message}`);
      }
    }
  });

  logger.info(MODULE, `Commands registered for ${woodBot.options.username}: !fill !bed !follow !stopfollow !stop !start !status !eat`);
}

/** Format a Vec3 position for chat output. */
function fmt(pos) {
  return `(${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)})`;
}

module.exports = { registerCommands };
