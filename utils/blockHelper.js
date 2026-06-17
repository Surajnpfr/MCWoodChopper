/**
 * Block and item identification helpers for all wood-related blocks.
 */

// All log block name patterns (covers oak_log, stripped_oak_log, etc.)
const LOG_NAMES = [
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'mangrove_log', 'cherry_log',
];

const LEAF_NAMES = [
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
  'azalea_leaves', 'flowering_azalea_leaves',
];

const SAPLING_NAMES = [
  'oak_sapling', 'birch_sapling', 'spruce_sapling', 'jungle_sapling',
  'acacia_sapling', 'dark_oak_sapling', 'mangrove_propagule', 'cherry_sapling',
];

const PLANTABLE_GROUND = [
  'dirt', 'grass_block', 'podzol', 'mycelium', 'rooted_dirt',
  'coarse_dirt', 'mud', 'muddy_mangrove_roots',
];

// Log type → sapling type mapping
const LOG_TO_SAPLING = {
  oak_log: 'oak_sapling',
  birch_log: 'birch_sapling',
  spruce_log: 'spruce_sapling',
  jungle_log: 'jungle_sapling',
  acacia_log: 'acacia_sapling',
  dark_oak_log: 'dark_oak_sapling',
  mangrove_log: 'mangrove_propagule',
  cherry_log: 'cherry_sapling',
};

// Items worth keeping (saplings, tools) vs depositing
const KEEP_ITEMS = [
  ...SAPLING_NAMES,
  'wooden_axe', 'stone_axe', 'iron_axe', 'golden_axe', 'diamond_axe', 'netherite_axe',
];

/**
 * Check if a block is a natural log (not stripped).
 */
function isLogBlock(block) {
  if (!block) return false;
  return LOG_NAMES.includes(block.name);
}

/**
 * Check if a block is a leaf block.
 */
function isLeafBlock(block) {
  if (!block) return false;
  return LEAF_NAMES.includes(block.name);
}

/**
 * Check if an item is a sapling.
 */
function isSapling(item) {
  if (!item) return false;
  return SAPLING_NAMES.includes(item.name);
}

/**
 * Get the matching sapling name for a given log type.
 */
function getSaplingForLog(logName) {
  return LOG_TO_SAPLING[logName] || null;
}

/**
 * Check if a block is suitable ground for planting.
 */
function isPlantableGround(block) {
  if (!block) return false;
  return PLANTABLE_GROUND.includes(block.name);
}

/**
 * Check if an item should be kept (not deposited into chest).
 */
function isKeepItem(item) {
  if (!item) return false;
  return KEEP_ITEMS.some(name => item.name.includes(name));
}

/**
 * Check if a block is an item frame (for chest detection).
 */
function isWoodItemFrame(bot, entity) {
  if (!entity) return false;
  // Item frames are entities; check if they hold a wood-related item
  if (entity.name !== 'item_frame') return false;
  // Check metadata for held item — if it contains any log/plank item
  const metadata = entity.metadata;
  if (!metadata) return false;
  return true; // We'll refine this check based on actual entity data
}

module.exports = {
  LOG_NAMES,
  LEAF_NAMES,
  SAPLING_NAMES,
  PLANTABLE_GROUND,
  LOG_TO_SAPLING,
  isLogBlock,
  isLeafBlock,
  isSapling,
  getSaplingForLog,
  isPlantableGround,
  isKeepItem,
  isWoodItemFrame,
};
