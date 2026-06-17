const { Vec3 } = require('vec3');
const logger = require('../utils/logger');
const { goToBlock } = require('../navigation/navigator');
const { getDepositableItems } = require('../inventory/inventoryManager');

const MODULE = 'ChestManager';

/**
 * Find the nearest chest within radius.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {number} radius - Search radius
 * @returns {Vec3 | null} Chest position, or null if not found
 */
function findStorageChest(bot, radius) {
  const mcData = require('minecraft-data')(bot.version);
  
  // Find IDs for all chest-like blocks
  const validBlocks = [
    mcData.blocksByName['chest']?.id,
    mcData.blocksByName['trapped_chest']?.id,
    mcData.blocksByName['barrel']?.id,
  ].filter(id => id !== undefined);

  if (validBlocks.length === 0) {
    logger.warn(MODULE, 'Chest block types not found in minecraft-data');
    return null;
  }

  // findBlock automatically finds the absolute closest block by default
  const nearestChest = bot.findBlock({
    matching: validBlocks,
    maxDistance: radius || 32,
  });

  if (!nearestChest) {
    logger.debug(MODULE, 'No chests found nearby');
    return null;
  }

  logger.info(MODULE, `Found storage chest at (${nearestChest.position.x}, ${nearestChest.position.y}, ${nearestChest.position.z})`);
  return nearestChest.position;
}

/**
 * Check if a chest position has a wooden item frame entity attached.
 */
function hasItemFrameNearby(bot, chestPos) {
  for (const entity of Object.values(bot.entities)) {
    // Item frames can be named 'item_frame' or 'glow_item_frame'
    if (entity.name === 'item_frame' || entity.name === 'glow_item_frame') {
      const dist = entity.position.distanceTo(chestPos);
      // Item frame should be within 1.5 blocks of the chest (attached to it)
      if (dist < 2) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Deposit excess items into the storage chest.
 * Keeps saplings and axes, deposits everything else.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {Vec3} chestPos - Position of the storage chest
 * @returns {Promise<number>} Number of item types deposited
 */
async function depositItems(bot, chestPos) {
  try {
    // Navigate to the chest
    const reached = await goToBlock(bot, chestPos);
    if (!reached) {
      logger.warn(MODULE, 'Could not reach storage chest');
      return 0;
    }

    // Open the chest
    const chestBlock = bot.blockAt(chestPos);
    if (!chestBlock) {
      logger.warn(MODULE, 'Chest block not found at expected position');
      return 0;
    }

    const chest = await bot.openContainer(chestBlock);

    // Get items to deposit and group them by type
    const itemsToDeposit = getDepositableItems(bot);
    const depositGroups = {};

    for (const item of itemsToDeposit) {
      const key = `${item.type}:${item.metadata}`;
      if (!depositGroups[key]) {
        depositGroups[key] = { type: item.type, metadata: item.metadata, name: item.name, count: 0 };
      }
      depositGroups[key].count += item.count;
    }

    let deposited = 0;
    for (const group of Object.values(depositGroups)) {
      try {
        await chest.deposit(group.type, group.metadata, group.count);
        deposited += group.count;
        logger.debug(MODULE, `Deposited ${group.count}x ${group.name}`);
        await sleep(200);
      } catch (err) {
        logger.warn(MODULE, `Failed to deposit ${group.name}: ${err.message}`);
        // Chest might be full
        if (err.message.includes('full') || err.message.includes('no room') || err.message.includes('destination full')) {
          logger.warn(MODULE, 'Storage chest is full!');
          break;
        }
      }
    }

    // Close the chest
    chest.close();

    logger.info(MODULE, `Deposited ${deposited} item types into storage chest`);
    return deposited;
  } catch (err) {
    logger.error(MODULE, `Error depositing items: ${err.message}`);
    return 0;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  findStorageChest,
  depositItems,
};
