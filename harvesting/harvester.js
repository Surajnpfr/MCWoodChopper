const { Vec3 } = require('vec3');
const logger = require('../utils/logger');
const { goToBlock } = require('../navigation/navigator');
const { equipBestAxe } = require('../inventory/inventoryManager');
const { isLogBlock } = require('../utils/blockHelper');

const MODULE = 'Harvester';

// Blocks the bot can use as scaffolding to pillar up
const SCAFFOLD_BLOCKS = [
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'mangrove_log', 'cherry_log',
  'dirt', 'cobblestone', 'netherrack', 'cobbled_deepslate',
  'stone', 'granite', 'diorite', 'andesite', 'sand', 'gravel',
];

/**
 * Chop an entire tree given its detected log positions.
 * Strategy:
 * 1. Navigate to tree base
 * 2. Chop trunk bottom-to-top by pillaring up alongside the tree
 * 3. Break scaffold blocks on the way down
 *
 * @param {import('mineflayer').Bot} bot
 * @param {{ position: Vec3, logType: string, logs: Vec3[] }} tree
 * @returns {Promise<number>} Number of logs chopped
 */
async function chopTree(bot, tree) {
  const { logs, logType, position } = tree;

  logger.info(MODULE, `Chopping ${logType} tree with ${logs.length} logs at (${position.x}, ${position.y}, ${position.z})`);

  // Equip best axe for faster chopping
  await equipBestAxe(bot);

  // Navigate to the tree base first
  const reached = await goToBlock(bot, position);
  if (!reached) {
    logger.warn(MODULE, 'Could not reach tree base, trying anyway...');
  }

  // Sort logs: bottom-to-top, trunk first (closest to tree base x,z)
  const sorted = [...logs].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    const distA = Math.abs(a.x - position.x) + Math.abs(a.z - position.z);
    const distB = Math.abs(b.x - position.x) + Math.abs(b.z - position.z);
    return distA - distB;
  });

  let chopped = 0;
  const scaffoldPositions = []; // Track placed scaffolding to break later

  // ── Phase 1: Chop all reachable logs from ground ───────────────────────
  const unreachable = [];

  for (const logPos of sorted) {
    try {
      const block = bot.blockAt(logPos);
      if (!block || block.name !== logType) continue;

      if (bot.canDigBlock(block) && bot.entity.position.distanceTo(logPos) <= 5) {
        await bot.dig(block);
        chopped++;
        logger.debug(MODULE, `Chopped log ${chopped}/${sorted.length} at ${logPos.toString()}`);
        await sleep(50);
      } else {
        unreachable.push(logPos);
      }
    } catch (err) {
      unreachable.push(logPos);
    }
  }

  // ── Phase 2: Pillar up to chop remaining high logs ─────────────────────
  if (unreachable.length > 0) {
    logger.info(MODULE, `${unreachable.length} logs above reach — pillaring up...`);

    // Find a scaffold position next to the trunk (offset by 1 block)
    const scaffoldX = position.x;
    const scaffoldZ = position.z;
    const baseY = position.y;

    // Find the highest unreachable log
    const maxY = Math.max(...unreachable.map(l => l.y));

    // Pillar up from tree base to max height
    let currentPillarY = baseY;

    // Move next to the trunk
    const pillarBase = new Vec3(scaffoldX, baseY, scaffoldZ);
    await goToBlock(bot, pillarBase);

    while (currentPillarY <= maxY) {
      // Re-equip axe (pillaring switches held item to scaffold block)
      await equipBestAxe(bot);

      // Try to dig any logs in reach at this height
      for (let i = unreachable.length - 1; i >= 0; i--) {
        const logPos = unreachable[i];
        try {
          const block = bot.blockAt(logPos);
          if (!block || block.name !== logType) {
            unreachable.splice(i, 1);
            continue;
          }

          const dist = bot.entity.position.distanceTo(logPos);
          if (dist <= 5 && bot.canDigBlock(block)) {
            await bot.dig(block);
            chopped++;
            unreachable.splice(i, 1);
            logger.debug(MODULE, `Chopped high log ${chopped}/${sorted.length} at ${logPos.toString()}`);
            await sleep(50);
          }
        } catch {
          // Will try again from higher position
        }
      }

      if (unreachable.length === 0) break;

      // Pillar up: jump and place block underneath
      const jumped = await pillarUp(bot, scaffoldPositions);
      if (!jumped) {
        logger.warn(MODULE, 'Cannot pillar up further (no scaffold blocks or failed)');
        break;
      }

      currentPillarY = Math.floor(bot.entity.position.y);
      await sleep(100);
    }

    // Final sweep at max height
    await equipBestAxe(bot);
    for (const logPos of unreachable) {
      try {
        const block = bot.blockAt(logPos);
        if (!block || block.name !== logType) continue;
        if (bot.canDigBlock(block) && bot.entity.position.distanceTo(logPos) <= 5) {
          await bot.dig(block);
          chopped++;
          await sleep(50);
        }
      } catch {
        // Skip
      }
    }

    // ── Phase 3: Break scaffold and come down ────────────────────────────
    await breakScaffold(bot, scaffoldPositions);
  }

  logger.info(MODULE, `Finished chopping tree: ${chopped}/${logs.length} logs harvested`);
  return chopped;
}

// Non-solid blocks that prevent placement (ground litter)
const LITTER_BLOCKS = [
  'short_grass', 'tall_grass', 'fern', 'large_fern',
  'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet',
  'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip',
  'oxeye_daisy', 'cornflower', 'lily_of_the_valley', 'wither_rose',
  'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'pitcher_plant',
  'dead_bush', 'sweet_berry_bush',
  'oak_sapling', 'birch_sapling', 'spruce_sapling', 'jungle_sapling',
  'acacia_sapling', 'dark_oak_sapling', 'cherry_sapling', 'mangrove_propagule',
  'brown_mushroom', 'red_mushroom',
  'snow', 'vine', 'lily_pad',
  'oak_leaves', 'birch_leaves', 'spruce_leaves', 'jungle_leaves',
  'acacia_leaves', 'dark_oak_leaves', 'mangrove_leaves', 'cherry_leaves',
  'azalea_leaves', 'flowering_azalea_leaves'
];

/**
 * Clear litter blocks (flowers, grass, saplings, leaves, etc.) around the bot's position.
 */
async function clearLitter(bot) {
  const botPos = bot.entity.position.floored();

  // Check a 3x3 area around the bot at foot level and up to 3 blocks high (to clear full head space for jumping)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy <= 3; dy++) {
        const pos = botPos.offset(dx, dy, dz);
        const block = bot.blockAt(pos);
        if (block && LITTER_BLOCKS.includes(block.name)) {
          try {
            if (bot.canDigBlock(block)) {
              await bot.dig(block);
              logger.debug(MODULE, `Cleared ${block.name} at ${pos.toString()}`);
            }
          } catch {
            // Ignore — not critical
          }
        }
      }
    }
  }
}

/**
 * Jump and place a block underneath to pillar up one block.
 * Returns true if successful.
 */
async function pillarUp(bot, scaffoldPositions) {
  // Clear any litter that would prevent placement
  await clearLitter(bot);

  // Find a scaffold block in inventory
  const scaffoldItem = bot.inventory.items().find(item =>
    SCAFFOLD_BLOCKS.includes(item.name)
  );

  if (!scaffoldItem) {
    logger.debug(MODULE, 'No scaffold blocks available for pillaring');
    return false;
  }

  try {
    // Equip the scaffold block
    await bot.equip(scaffoldItem, 'hand');

    // Jump
    bot.setControlState('jump', true);
    await sleep(350); // Wait until near peak of jump

    // Place block below feet
    const belowPos = bot.entity.position.offset(0, -1, 0).floored();
    const blockBelow = bot.blockAt(belowPos);

    // We need to place on a reference block — the block below where we want to place
    const refPos = belowPos.offset(0, -1, 0);
    const refBlock = bot.blockAt(refPos);

    if (refBlock && refBlock.name !== 'air') {
      await bot.placeBlock(refBlock, new Vec3(0, 1, 0));
      scaffoldPositions.push(belowPos.clone());
      logger.debug(MODULE, `Placed scaffold at ${belowPos.toString()}`);
    }

    bot.setControlState('jump', false);
    await sleep(200);

    return true;
  } catch (err) {
    bot.setControlState('jump', false);
    logger.debug(MODULE, `Pillar up failed: ${err.message}`);
    return false;
  }
}

/**
 * Break all scaffold blocks placed during pillaring (top to bottom).
 */
async function breakScaffold(bot, scaffoldPositions) {
  if (scaffoldPositions.length === 0) return;

  logger.debug(MODULE, `Breaking ${scaffoldPositions.length} scaffold blocks...`);

  // Break from top to bottom (reverse order — we placed bottom to top)
  for (let i = scaffoldPositions.length - 1; i >= 0; i--) {
    try {
      const block = bot.blockAt(scaffoldPositions[i]);
      if (block && block.name !== 'air' && bot.canDigBlock(block)) {
        await bot.dig(block);
        await sleep(100);
      }
    } catch {
      // Block may already be broken
    }
  }

  // Wait to land
  await sleep(500);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  chopTree,
};
