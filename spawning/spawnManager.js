// spawning/spawnManager.js
// Sets the bot's spawn point by right-clicking (activating) the nearest bed.
// Works at any time of day — no sleep required.

const { goTo } = require('../navigation/navigator');
const logger = require('../utils/logger');

const MODULE = 'SpawnManager';

/**
 * Find the nearest bed block within the given radius.
 * Supports all 16 colored beds.
 * @param {import('mineflayer').Bot} bot
 * @param {number} radius
 * @returns {import('prismarine-block').Block | null}
 */
function findNearestBed(bot, radius) {
  const mcData = require('minecraft-data')(bot.version);
  const bedNames = Object.keys(mcData.blocksByName).filter(name => name.endsWith('_bed'));
  const bedIds = bedNames.map(name => mcData.blocksByName[name].id).filter(Boolean);
  if (bedIds.length === 0) return null;

  const bedPositions = bot.findBlocks({
    matching: bedIds,
    maxDistance: radius,
    count: 64,
  });

  if (!bedPositions || bedPositions.length === 0) return null;

  const botPos = bot.entity.position;
  bedPositions.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));
  return bot.blockAt(bedPositions[0]);
}

/**
 * Walk to the nearest bed and right-click it to set spawn point instantly.
 * Works at any time of day — uses activateBlock() instead of sleep().
 * If the server is in daytime and activateBlock explodes (nether/end message),
 * the error is caught and the bot continues safely.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {number} radius - Search radius for beds.
 * @returns {Promise<boolean>} true if spawn was set successfully.
 */
async function setSpawnToNearestBed(bot, radius) {
  if (!bot.entity) return false;

  const bedBlock = findNearestBed(bot, radius);
  if (!bedBlock) {
    logger.warn(MODULE, 'No bed found within radius, spawn point unchanged');
    return false;
  }

  // Navigate close to the bed
  const reached = await goTo(bot, bedBlock.position, 20000);
  if (!reached) {
    logger.warn(MODULE, `Could not reach bed at ${bedBlock.position}`);
    return false;
  }

  try {
    // Right-click the bed — sets respawn point at any time of day
    await bot.activateBlock(bedBlock);
    logger.info(MODULE, `Spawn point set to bed at ${bedBlock.position} (right-click)`);
    return true;
  } catch (err) {
    // activateBlock can throw if the bed explodes (Nether/End) or is occupied.
    // This is non-fatal — just log and continue.
    logger.warn(MODULE, `Could not activate bed: ${err.message}`);
    return false;
  }
}

module.exports = { setSpawnToNearestBed };
