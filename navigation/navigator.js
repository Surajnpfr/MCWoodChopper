const { goals, Movements } = require('mineflayer-pathfinder');
const logger = require('../utils/logger');

const MODULE = 'Navigator';

/**
 * Navigate the bot to a target position using mineflayer-pathfinder.
 * Includes stuck detection and safe movement configuration.
 */
async function goTo(bot, position, timeout) {
  const stuckTimeout = timeout || 15000;

  return new Promise((resolve, reject) => {
    const mcData = require('minecraft-data')(bot.version);
    const movements = new Movements(bot, mcData);

    // Safety: avoid dangerous blocks
    movements.allowSprinting = true;
    movements.canDig = true;
    movements.allow1by1towers = true;
    movements.scafoldingBlocks = [];
    movements.maxDropDown = 4;

    bot.pathfinder.setMovements(movements);

    const goal = new goals.GoalNear(position.x, position.y, position.z, 2);

    let stuckTimer = null;
    let lastPos = bot.entity.position.clone();
    let completed = false;

    const cleanup = () => {
      if (stuckTimer) clearInterval(stuckTimer);
      completed = true;
    };

    // Stuck detection: check every 3s if bot has moved
    stuckTimer = setInterval(() => {
      if (completed) return clearInterval(stuckTimer);

      const currentPos = bot.entity.position;
      const dist = currentPos.distanceTo(lastPos);

      if (dist < 0.5) {
        logger.warn(MODULE, `Bot appears stuck at ${currentPos.toString()}, cancelling navigation`);
        cleanup();
        bot.pathfinder.stop();
        resolve(false); // Indicate failure but don't throw
      }

      lastPos = currentPos.clone();
    }, 3000);

    // Timeout failsafe
    const timeoutTimer = setTimeout(() => {
      if (!completed) {
        logger.warn(MODULE, `Navigation timed out after ${stuckTimeout}ms`);
        cleanup();
        bot.pathfinder.stop();
        resolve(false);
      }
    }, stuckTimeout);

    bot.pathfinder.goto(goal)
      .then(() => {
        clearTimeout(timeoutTimer);
        cleanup();
        logger.debug(MODULE, `Reached target at ${position.toString()}`);
        resolve(true);
      })
      .catch((err) => {
        clearTimeout(timeoutTimer);
        cleanup();
        logger.warn(MODULE, `Navigation failed: ${err.message}`);
        resolve(false);
      });
  });
}

/**
 * Move bot to within reach distance of a block position.
 */
async function goToBlock(bot, blockPos) {
  return goTo(bot, blockPos, 20000);
}

module.exports = {
  goTo,
  goToBlock,
};
