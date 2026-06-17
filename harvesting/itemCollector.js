const logger = require('../utils/logger');
const { goTo } = require('../navigation/navigator');

const MODULE = 'ItemCollector';

/**
 * Collect dropped items near the bot's position.
 * Walks to each dropped item entity to pick it up.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {number} radius - Collection radius
 * @returns {Promise<number>} Number of collection attempts
 */
async function collectDrops(bot, radius) {
  // Wait for items to drop and settle after chopping
  await sleep(1000);

  let collected = 0;
  let attempts = 0;
  const maxAttempts = 30;

  const attemptedIds = new Set();

  while (attempts < maxAttempts) {
    attempts++;

    // Find all nearby dropped item entities
    const items = [];
    for (const entity of Object.values(bot.entities)) {
      if (!entity || !entity.position) continue;
      
      // Skip items we already tried and failed to pick up
      if (attemptedIds.has(entity.id)) continue;

      // In newer Mineflayer versions, dropped items are often 'item' or type 'object'
      const isItem = entity.name === 'item' ||
                     entity.type === 'object' ||
                     entity.entityType === 'item' ||
                     (entity.objectType === 'Item' || entity.objectType === 'item');

      if (isItem) {
        const dist = bot.entity.position.distanceTo(entity.position);
        if (dist <= radius) {
          items.push({ entity, dist });
        }
      }
    }

    if (items.length === 0) {
      if (attempts === 1) {
        // Log all nearby entities on the first attempt so we can see what they are named
        const allEntities = Object.values(bot.entities)
          .filter(e => e.position && bot.entity.position.distanceTo(e.position) <= radius)
          .map(e => `${e.name || e.type || e.objectType}(id:${e.id})`)
          .join(', ');
        logger.debug(MODULE, `No items found nearby. Entities in radius: ${allEntities}`);
      }
      break;
    }

    // Sort by distance — closest first
    items.sort((a, b) => a.dist - b.dist);

    const target = items[0];
    logger.info(MODULE, `Walking to item at (${Math.round(target.entity.position.x)}, ${Math.round(target.entity.position.y)}, ${Math.round(target.entity.position.z)}) — ${target.dist.toFixed(1)} blocks away`);

    try {
      if (target.dist > 1.5) {
        // Walk toward the item
        await goTo(bot, target.entity.position, 5000);
      }

      // Wait a moment for auto-pickup
      await sleep(400);
      
      // Check if it's still there
      if (bot.entities[target.entity.id]) {
        // Still there after waiting, mark as attempted so we don't get stuck
        attemptedIds.add(target.entity.id);
        logger.debug(MODULE, `Failed to pick up item at ${target.entity.position.toString()}`);
      } else {
        collected++;
      }
    } catch (err) {
      logger.warn(MODULE, `Collection walk failed: ${err.message}`);
      attemptedIds.add(target.entity.id);
      await sleep(200);
    }
  }

  if (collected > 0) {
    logger.info(MODULE, `Picked up items (${collected} collection walks)`);
  }

  return collected;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  collectDrops,
};
