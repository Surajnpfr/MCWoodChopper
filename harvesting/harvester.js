const { Vec3 } = require('vec3');
const logger = require('../utils/logger');
const { goToBlock, goTo } = require('../navigation/navigator');
const { equipBestAxe } = require('../inventory/inventoryManager');
const { isLogBlock } = require('../utils/blockHelper');

const MODULE = 'Harvester';

// Blocks the bot can use as scaffolding to pillar up
// Using logs because the bot has an axe — breaks them instantly and recovers them
const SCAFFOLD_BLOCKS = [
  'scaffolding',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'mangrove_log', 'cherry_log',
  'oak_planks', 'birch_planks', 'spruce_planks', 'jungle_planks',
  'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks',
  'dirt', 'cobblestone', // fallback only
];

/**
 * Chop an entire tree given its detected log positions.
 *
 * Strategy (redesigned for reliability):
 *   1. Navigate to the tree base
 *   2. Chop ALL logs bottom-to-top. For each log:
 *      a. If the bot can dig it from its current position, dig it.
 *      b. If not, walk underneath/beside the log and pillar up until it's in range.
 *   3. Break scaffold blocks on the way down.
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

  // Clear surrounding litter at the tree base
  await clearLitter(bot);

  // Sort logs: bottom-to-top, trunk first (closest to tree base x,z)
  const sorted = [...logs].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    const distA = Math.abs(a.x - position.x) + Math.abs(a.z - position.z);
    const distB = Math.abs(b.x - position.x) + Math.abs(b.z - position.z);
    return distA - distB;
  });

  let chopped = 0;
  const scaffoldPositions = []; // Track placed scaffolding to break later

  for (const logPos of sorted) {
    // Re-check block: it may have been broken already (gravity / earlier pass)
    const block = bot.blockAt(logPos);
    if (!block || block.name !== logType) continue;

    // Attempt 1: Try to dig from current position
    let dug = await tryDig(bot, block, logPos);
    if (dug) {
      chopped++;
      await sleep(50);
      continue;
    }

    // Attempt 2: Walk directly under/beside the log, then try again
    const approachPos = new Vec3(logPos.x, position.y, logPos.z);
    await goTo(bot, approachPos, 10000);
    await equipBestAxe(bot);

    // Re-fetch block (might have changed)
    const block2 = bot.blockAt(logPos);
    if (!block2 || block2.name !== logType) continue;

    dug = await tryDig(bot, block2, logPos);
    if (dug) {
      chopped++;
      await sleep(50);
      continue;
    }

    // Attempt 3: Pillar up until the log is within reach (max 10 blocks up)
    const pillarStart = bot.entity.position.clone();
    let pillarSuccess = false;

    for (let p = 0; p < 10; p++) {
      // Re-check if the log still exists before each pillar step
      const blockCheck = bot.blockAt(logPos);
      if (!blockCheck || blockCheck.name !== logType) {
        pillarSuccess = true; // log is already gone
        break;
      }

      // Try to dig from current height
      const dist = bot.entity.position.distanceTo(logPos);
      if (dist <= 5) {
        await equipBestAxe(bot);
        dug = await tryDig(bot, blockCheck, logPos);
        if (dug) {
          chopped++;
          pillarSuccess = true;
          break;
        }
      }

      // Pillar up one block
      const jumped = await pillarUp(bot, scaffoldPositions);
      if (!jumped) {
        logger.warn(MODULE, `Cannot pillar up further at height ${p + 1}`);
        break;
      }
      await sleep(150);
    }

    // If we still have unreached logs but pillared up, try one final dig
    if (!pillarSuccess) {
      const blockFinal = bot.blockAt(logPos);
      if (blockFinal && blockFinal.name === logType) {
        await equipBestAxe(bot);
        dug = await tryDig(bot, blockFinal, logPos);
        if (dug) chopped++;
      }
    }

    await sleep(50);
  }

  // ── Break scaffold and come down ──────────────────────────────────────
  await breakScaffold(bot, scaffoldPositions);

  // Collect any items that landed on the ground
  await sleep(500);

  logger.info(MODULE, `Finished chopping tree: ${chopped}/${logs.length} logs harvested`);
  return chopped;
}

/**
 * Attempt to dig a block. Returns true if successful.
 * Handles all error cases gracefully.
 */
async function tryDig(bot, block, logPos) {
  try {
    if (!block || block.name === 'air') return false;
    const dist = bot.entity.position.distanceTo(logPos);
    // Minecraft max interact distance is about 4.5 blocks; be generous
    if (dist > 5) return false;
    if (!bot.canDigBlock(block)) return false;
    await bot.dig(block);
    logger.debug(MODULE, `Chopped log at ${logPos.toString()}`);
    return true;
  } catch (err) {
    logger.debug(MODULE, `tryDig failed at ${logPos.toString()}: ${err.message}`);
    return false;
  }
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
 * Clear litter blocks around the bot's current position.
 */
async function clearLitter(bot) {
  const botPos = bot.entity.position.floored();
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dy = 0; dy <= 3; dy++) {
        const pos = botPos.offset(dx, dy, dz);
        const block = bot.blockAt(pos);
        if (block && LITTER_BLOCKS.includes(block.name)) {
          try {
            if (bot.canDigBlock(block)) {
              await bot.dig(block);
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
 * Precise version: uses target ground block tracking, jump release, and height verification.
 * Returns true if the bot is now 1 block higher.
 */
async function pillarUp(bot, scaffoldPositions) {
  // Find a scaffold block in inventory
  const scaffoldItem = bot.inventory.items().find(item =>
    SCAFFOLD_BLOCKS.includes(item.name)
  );

  if (!scaffoldItem) {
    logger.debug(MODULE, 'No scaffold blocks available for pillaring');
    return false;
  }

  const startY = bot.entity.position.y;
  const groundBlockPos = bot.entity.position.offset(0, -1, 0).floored();
  const groundBlock = bot.blockAt(groundBlockPos);

  if (!groundBlock || groundBlock.name === 'air' || groundBlock.name === 'cave_air') {
    logger.debug(MODULE, 'No solid ground block under feet to place against');
    return false;
  }

  try {
    // Step 1: Equip the scaffold block
    await bot.equip(scaffoldItem, 'hand');

    // Step 2: Look straight down
    await bot.look(0, -Math.PI / 2, true);

    // Step 3: Trigger jump
    bot.setControlState('jump', true);

    // Wait until we have jumped high enough (apex is usually around 1.25m, wait until > 0.8m)
    let waited = 0;
    while (bot.entity.position.y - startY < 0.8 && waited < 500) {
      await sleep(50);
      waited += 50;
    }

    // Release jump immediately so we don't double jump
    bot.setControlState('jump', false);

    // Step 4: Place block on top of ground block
    await bot.placeBlock(groundBlock, new Vec3(0, 1, 0));
    const placedPos = groundBlockPos.offset(0, 1, 0);
    scaffoldPositions.push(placedPos);
    logger.debug(MODULE, `Placed scaffold at ${placedPos.toString()}`);

    // Step 5: Wait to land
    await sleep(300);

    // Step 6: Verify height increase
    const endY = bot.entity.position.y;
    if (endY - startY < 0.5) {
      logger.debug(MODULE, `Pillar failed: only moved ${(endY - startY).toFixed(2)} blocks up`);
      return false;
    }

    logger.debug(MODULE, `Pillared up to Y=${Math.floor(endY)} (from Y=${Math.floor(startY)})`);
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

  // Re-equip axe/pickaxe for faster breaking
  await equipBestAxe(bot);

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
