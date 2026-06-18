const { goals, Movements } = require('mineflayer-pathfinder');
const logger = require('../utils/logger');

const MODULE = 'Navigator';

/**
 * Navigate the bot to a target position using mineflayer-pathfinder.
 * Includes stuck detection and safe movement configuration.
 */
async function goTo(bot, position, timeout) {
  const stuckTimeout = timeout || 15000;

  return new Promise((resolve) => {
    try {
      if (bot.pathfinder.isMoving()) {
        bot.pathfinder.stop();
      }

      const mcData = require('minecraft-data')(bot.version);
      const movements = new Movements(bot, mcData);

      movements.allowSprinting = true;
      movements.canDig = true;
      movements.allow1by1towers = true;
      movements.scafoldingBlocks = [];
      movements.maxDropDown = 4;

      bot.pathfinder.setMovements(movements);

      // GoalGetToBlock gets the bot adjacent to the block
      const goal = new goals.GoalGetToBlock(position.x, position.y, position.z);

      let stuckTimer = null;
      let lastPos = bot.entity.position.clone();
      let completed = false;

      const cleanup = () => {
        if (stuckTimer) clearInterval(stuckTimer);
        completed = true;
      };

      stuckTimer = setInterval(() => {
        if (completed) return clearInterval(stuckTimer);
        const currentPos = bot.entity.position;
        if (currentPos.distanceTo(lastPos) < 0.5) {
          logger.warn(MODULE, `Bot appears stuck, cancelling navigation`);
          cleanup();
          bot.pathfinder.stop();
          resolve(false);
        }
        lastPos = currentPos.clone();
      }, 4000);

      const timeoutTimer = setTimeout(() => {
        if (!completed) {
          logger.warn(MODULE, `Navigation timed out`);
          cleanup();
          bot.pathfinder.stop();
          resolve(false);
        }
      }, stuckTimeout);

      bot.pathfinder.goto(goal)
        .then(() => {
          clearTimeout(timeoutTimer);
          cleanup();
          resolve(true);
        })
        .catch((err) => {
          clearTimeout(timeoutTimer);
          cleanup();
          // Ignore the 'goal was changed' error as it just means we interrupted it intentionally
          if (err.message !== 'The goal was changed before it could be completed!') {
            logger.warn(MODULE, `Navigation failed: ${err.message}`);
          }
          resolve(false);
        });
    } catch (err) {
      logger.error(MODULE, `GoTo error: ${err.message}`);
      resolve(false);
    }
  });
}

/**
 * Move bot to within reach distance of a block position.
 */
async function goToBlock(bot, blockPos) {
  // Use the unified goTo logic (which employs GoalGetToBlock) to approach the block
  return goTo(bot, blockPos, 20000);
}


module.exports = {
  goTo,
  goToBlock,
};
