const logger = require('../utils/logger');
const { isKeepItem, SAPLING_NAMES } = require('../utils/blockHelper');

const MODULE = 'Inventory';

// Axe tiers ordered from best to worst
const AXE_TIERS = [
  'netherite_axe',
  'diamond_axe',
  'iron_axe',
  'golden_axe',
  'stone_axe',
  'wooden_axe',
];

/**
 * Equip the best available axe from inventory.
 */
async function equipBestAxe(bot) {
  const items = bot.inventory.items();

  // Log all items so we can see what mineflayer calls them
  if (items.length > 0) {
    const names = items.map(i => `${i.name}|${i.displayName}(x${i.count})`).join(', ');
    logger.info(MODULE, `Inventory [${items.length} items]: ${names}`);
  } else {
    logger.warn(MODULE, 'Inventory is empty!');
    return false;
  }

  // Strategy 1: Match by exact tier name
  for (const axeName of AXE_TIERS) {
    const axe = items.find(item => item.name === axeName);
    if (axe) {
      try {
        await bot.equip(axe, 'hand');
        logger.info(MODULE, `✅ Equipped ${axe.name}`);
        return true;
      } catch (err) {
        logger.warn(MODULE, `Failed to equip ${axe.name}: ${err.message}`);
      }
    }
  }

  // Strategy 2: Match by displayName (e.g., "Diamond Axe")
  for (const axeName of AXE_TIERS) {
    const displayMatch = axeName.replace(/_/g, ' ');
    const axe = items.find(item =>
      (item.displayName || '').toLowerCase().includes(displayMatch)
    );
    if (axe) {
      try {
        await bot.equip(axe, 'hand');
        logger.info(MODULE, `✅ Equipped (by displayName) ${axe.displayName}`);
        return true;
      } catch (err) {
        logger.warn(MODULE, `Failed to equip ${axe.displayName}: ${err.message}`);
      }
    }
  }

  // Strategy 3: Anything with "axe" in name or displayName
  const anyAxe = items.find(item =>
    item.name.includes('axe') ||
    (item.displayName || '').toLowerCase().includes('axe')
  );
  if (anyAxe) {
    try {
      await bot.equip(anyAxe, 'hand');
      logger.info(MODULE, `✅ Equipped (fallback) ${anyAxe.name} / ${anyAxe.displayName}`);
      return true;
    } catch (err) {
      logger.warn(MODULE, `Failed to equip ${anyAxe.name}: ${err.message}`);
    }
  }

  logger.warn(MODULE, 'No axe found in inventory — will mine with fist');
  return false;
}

/**
 * Get inventory fullness as a percentage (0-100).
 */
function getInventoryFullness(bot) {
  const slots = bot.inventory.slots;
  let used = 0;
  let total = 0;

  // Player inventory slots 9-44 (main inventory + hotbar)
  for (let i = 9; i <= 44; i++) {
    total++;
    if (slots[i]) used++;
  }

  return total > 0 ? Math.round((used / total) * 100) : 0;
}

/**
 * Check if inventory is above threshold.
 */
function isInventoryFull(bot, threshold) {
  return getInventoryFullness(bot) >= (threshold || 90);
}

/**
 * Check if bot has saplings of a specific type (or any).
 */
function hasSaplings(bot, saplingName) {
  if (saplingName) {
    return bot.inventory.items().some(item => item.name === saplingName);
  }
  return bot.inventory.items().some(item => SAPLING_NAMES.includes(item.name));
}

/**
 * Count saplings of a specific type.
 */
function countSaplings(bot, saplingName) {
  return bot.inventory.items()
    .filter(item => saplingName ? item.name === saplingName : SAPLING_NAMES.includes(item.name))
    .reduce((sum, item) => sum + item.count, 0);
}

/**
 * Count all wood logs in inventory.
 */
function countLogs(bot) {
  return bot.inventory.items()
    .filter(item => item.name.endsWith('_log'))
    .reduce((sum, item) => sum + item.count, 0);
}

/**
 * Get a summary of the inventory contents.
 */
function getInventorySummary(bot) {
  const items = {};
  for (const item of bot.inventory.items()) {
    if (items[item.name]) {
      items[item.name] += item.count;
    } else {
      items[item.name] = item.count;
    }
  }
  return items;
}

/**
 * Get items that should be deposited into storage.
 * Keeps axes, saplings, all food items, 'scaffolding' blocks, and up to 64 wood logs/planks.
 */
function getDepositableItems(bot) {
  const { FOOD_ITEMS } = require('../survival/foodManager');
  const items = bot.inventory.items();
  const depositable = [];
  
  let scaffoldBlocksToKeep = 64;

  for (const item of items) {
    // 1. Keep axes
    if (item.name.includes('axe') || (item.displayName || '').toLowerCase().includes('axe')) {
      continue;
    }
    // 2. Keep saplings
    if (SAPLING_NAMES.includes(item.name)) {
      continue;
    }
    // 3. Keep food items
    if (FOOD_ITEMS.includes(item.name)) {
      continue;
    }
    // 4. Keep scaffolding block
    if (item.name === 'scaffolding') {
      continue;
    }
    // 5. Keep up to 64 wood logs/planks (scaffolding)
    const isWoodLogOrPlank = item.name.endsWith('_log') || item.name.endsWith('_planks');
    if (isWoodLogOrPlank) {
      if (item.count <= scaffoldBlocksToKeep) {
        scaffoldBlocksToKeep -= item.count;
        continue;
      } else {
        const depositCount = item.count - scaffoldBlocksToKeep;
        scaffoldBlocksToKeep = 0;
        depositable.push({ ...item, count: depositCount });
        continue;
      }
    }

    // 6. Otherwise, deposit the item
    depositable.push(item);
  }

  return depositable;
}


module.exports = {
  equipBestAxe,
  getInventoryFullness,
  isInventoryFull,
  hasSaplings,
  countSaplings,
  countLogs,
  getInventorySummary,
  getDepositableItems,
};
