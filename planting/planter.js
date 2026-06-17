const { Vec3 } = require('vec3');
const logger = require('../utils/logger');
const { getSaplingForLog, isPlantableGround, SAPLING_NAMES } = require('../utils/blockHelper');

const MODULE = 'Planter';

/**
 * Replant a sapling at the position where a tree was harvested.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {Vec3} position - The base position of the chopped tree
 * @param {string} logType - The log type that was harvested (e.g., 'oak_log')
 * @returns {Promise<boolean>} Whether replanting was successful
 */
async function replantSapling(bot, position, logType) {
  const saplingName = getSaplingForLog(logType);
  if (!saplingName) {
    logger.warn(MODULE, `No sapling mapping for log type: ${logType}`);
    return false;
  }

  // Check if bot has the right sapling
  const sapling = bot.inventory.items().find(item => item.name === saplingName);
  if (!sapling) {
    // Try any sapling as fallback
    const anySapling = bot.inventory.items().find(item => SAPLING_NAMES.includes(item.name));
    if (!anySapling) {
      logger.warn(MODULE, 'No saplings available for replanting');
      return false;
    }
    logger.info(MODULE, `No ${saplingName} available, using ${anySapling.name} instead`);
    return await plantAt(bot, position, anySapling);
  }

  return await plantAt(bot, position, sapling);
}

/**
 * Place a sapling at the given position.
 */
async function plantAt(bot, position, saplingItem) {
  try {
    // Check ground block below the tree base
    const groundPos = position.offset(0, -1, 0);
    const groundBlock = bot.blockAt(groundPos);

    if (!groundBlock || !isPlantableGround(groundBlock)) {
      logger.warn(MODULE, `Ground at ${groundPos.toString()} is not plantable (${groundBlock?.name || 'unknown'})`);
      return false;
    }

    // Check the planting position is clear (air or replaceable)
    const plantBlock = bot.blockAt(position);
    if (plantBlock && plantBlock.name !== 'air' && plantBlock.name !== 'cave_air') {
      logger.debug(MODULE, `Block at planting position is ${plantBlock.name}, not air`);
      return false;
    }

    // Equip the sapling
    await bot.equip(saplingItem, 'hand');

    // Place sapling on the ground block
    const groundBlockRef = bot.blockAt(groundPos);
    if (!groundBlockRef) return false;

    await bot.placeBlock(groundBlockRef, new Vec3(0, 1, 0));

    logger.info(MODULE, `Planted ${saplingItem.name} at (${position.x}, ${position.y}, ${position.z})`);
    return true;
  } catch (err) {
    logger.warn(MODULE, `Failed to plant sapling: ${err.message}`);
    return false;
  }
}

module.exports = {
  replantSapling,
};
