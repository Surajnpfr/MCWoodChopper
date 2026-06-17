const { Vec3 } = require('vec3');
const { isLogBlock, isLeafBlock, LOG_NAMES } = require('../utils/blockHelper');
const logger = require('../utils/logger');

const MODULE = 'TreeDetector';

/**
 * Find the nearest valid tree within a given radius.
 * Validates that it's a natural tree (connected logs with leaf canopy),
 * not a player-built structure.
 *
 * @param {import('mineflayer').Bot} bot
 * @param {number} radius - Search radius in blocks
 * @returns {{ position: Vec3, logType: string, logs: Vec3[] } | null}
 */
function findNearestTree(bot, radius) {
  const mcData = require('minecraft-data')(bot.version);

  // Get all log block IDs
  const logBlockIds = LOG_NAMES
    .map(name => mcData.blocksByName[name])
    .filter(Boolean)
    .map(b => b.id);

  if (logBlockIds.length === 0) {
    logger.warn(MODULE, 'No log block types found in minecraft-data for this version');
    return null;
  }

  // Find all log blocks within radius
  const logBlocks = bot.findBlocks({
    matching: logBlockIds,
    maxDistance: radius,
    count: 256,
  });

  if (logBlocks.length === 0) {
    logger.debug(MODULE, 'No log blocks found within radius');
    return null;
  }

  // Group logs into potential tree structures
  // Sort by distance from bot
  const botPos = bot.entity.position;
  logBlocks.sort((a, b) => a.distanceTo(botPos) - b.distanceTo(botPos));

  // Try each log position as potential tree base
  const visited = new Set();

  for (const logPos of logBlocks) {
    const key = `${logPos.x},${logPos.z}`;
    if (visited.has(key)) continue;
    visited.add(key);

    const tree = validateTree(bot, logPos, mcData);
    if (tree) {
      logger.info(MODULE, `Found valid tree at (${tree.position.x}, ${tree.position.y}, ${tree.position.z}) - ${tree.logType} with ${tree.logs.length} logs`);
      return tree;
    }
  }

  logger.debug(MODULE, 'No valid trees found among detected logs');
  return null;
}

/**
 * Validate whether a log block is part of a natural tree.
 * Criteria:
 * 1. Must have a vertical column of same-type logs
 * 2. Must have leaves adjacent to or above the top logs
 * 3. Column must be at least 3 blocks tall (filters out small player structures)
 */
function validateTree(bot, startPos, mcData) {
  // Find the bottom of the log column at this x,z
  let bottomY = startPos.y;
  while (true) {
    const blockBelow = bot.blockAt(new Vec3(startPos.x, bottomY - 1, startPos.z));
    if (blockBelow && isLogBlock(blockBelow)) {
      bottomY--;
    } else {
      break;
    }
  }

  const bottomBlock = bot.blockAt(new Vec3(startPos.x, bottomY, startPos.z));
  if (!bottomBlock || !isLogBlock(bottomBlock)) return null;

  const logType = bottomBlock.name;

  // Trace upward to find all logs in this column
  const logs = [];
  let currentY = bottomY;
  while (true) {
    const block = bot.blockAt(new Vec3(startPos.x, currentY, startPos.z));
    if (block && block.name === logType) {
      logs.push(new Vec3(startPos.x, currentY, startPos.z));
      currentY++;
    } else {
      break;
    }
  }

  // Must be at least 3 logs tall to be a tree (filters isolated logs)
  if (logs.length < 3) return null;

  // Check for leaves near the top of the tree
  const topLogY = logs[logs.length - 1].y;
  let leafCount = 0;

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dy = -1; dy <= 3; dy++) {
        const checkPos = new Vec3(startPos.x + dx, topLogY + dy, startPos.z + dz);
        const block = bot.blockAt(checkPos);
        if (block && isLeafBlock(block)) {
          leafCount++;
        }
      }
    }
  }

  // Need at least 5 leaves to consider it a natural tree
  if (leafCount < 5) return null;

  // Check ground below — should be dirt/grass (natural terrain)
  const groundBlock = bot.blockAt(new Vec3(startPos.x, bottomY - 1, startPos.z));
  const naturalGround = groundBlock && (
    groundBlock.name === 'dirt' ||
    groundBlock.name === 'grass_block' ||
    groundBlock.name === 'podzol' ||
    groundBlock.name === 'mycelium' ||
    groundBlock.name === 'rooted_dirt' ||
    groundBlock.name === 'coarse_dirt' ||
    groundBlock.name === 'mud'
  );

  if (!naturalGround) return null;

  // Also find any branching logs (for jungle/dark oak trees)
  const allTreeLogs = [...logs];
  findBranchLogs(bot, logs, logType, allTreeLogs, new Set(logs.map(l => l.toString())));

  return {
    position: new Vec3(startPos.x, bottomY, startPos.z),
    logType,
    logs: allTreeLogs,
  };
}

/**
 * Recursively find branch logs connected to the main trunk.
 */
function findBranchLogs(bot, frontier, logType, allLogs, visited) {
  const newFrontier = [];

  for (const logPos of frontier) {
    // Check all 6 neighbors + diagonals on same Y and Y+1
    const neighbors = [
      logPos.offset(1, 0, 0), logPos.offset(-1, 0, 0),
      logPos.offset(0, 0, 1), logPos.offset(0, 0, -1),
      logPos.offset(1, 0, 1), logPos.offset(-1, 0, -1),
      logPos.offset(1, 0, -1), logPos.offset(-1, 0, 1),
      logPos.offset(0, 1, 0),
      logPos.offset(1, 1, 0), logPos.offset(-1, 1, 0),
      logPos.offset(0, 1, 1), logPos.offset(0, 1, -1),
    ];

    for (const nPos of neighbors) {
      const key = nPos.toString();
      if (visited.has(key)) continue;
      visited.add(key);

      const block = bot.blockAt(nPos);
      if (block && block.name === logType) {
        allLogs.push(nPos);
        newFrontier.push(nPos);
      }
    }
  }

  // Recurse with new frontier (limited depth to prevent infinite loops)
  if (newFrontier.length > 0 && allLogs.length < 100) {
    findBranchLogs(bot, newFrontier, logType, allLogs, visited);
  }
}

module.exports = {
  findNearestTree,
};
