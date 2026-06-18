/**
 * survival/foodManager.js
 * 
 * Manages hunger: eats food from inventory when hunger drops below threshold,
 * or asks for food in chat if inventory has none.
 */

const logger = require('../utils/logger');

const MODULE = 'FoodManager';

// All edible food items in Minecraft (sorted roughly by saturation, best first)
const FOOD_ITEMS = [
  'golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton',
  'cooked_salmon', 'cooked_chicken', 'cooked_rabbit', 'cooked_cod',
  'rabbit_stew', 'mushroom_stew', 'suspicious_stew', 'beetroot_soup',
  'bread', 'baked_potato', 'pumpkin_pie',
  'golden_apple', 'enchanted_golden_apple',
  'apple', 'sweet_berries', 'glow_berries', 'melon_slice',
  'carrot', 'beetroot', 'potato',
  'dried_kelp', 'cookie',
  'beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'salmon', 'cod',
  // Raw foods (last resort — can give hunger effect but better than starving)
  'rotten_flesh', 'spider_eye',
];

/**
 * Check hunger and eat food if needed.
 * If hunger < threshold and no food in inventory, ask in chat.
 * 
 * @param {import('mineflayer').Bot} bot
 * @param {number} threshold - Hunger level below which to eat (default 5)
 * @returns {Promise<boolean>} true if ate food, false otherwise
 */
async function checkAndEat(bot, threshold = 5) {
  if (!bot.entity) return false;

  const hunger = bot.food; // 0-20, 20 = full

  // No need to eat
  if (hunger >= threshold) return false;

  logger.info(MODULE, `Hunger is ${hunger}/20 (threshold: ${threshold}) — looking for food...`);

  // Find any food item in inventory
  const foodItem = bot.inventory.items().find(item =>
    FOOD_ITEMS.includes(item.name)
  );

  if (foodItem) {
    try {
      // Equip and consume the food
      await bot.equip(foodItem, 'hand');
      await bot.consume();
      logger.info(MODULE, `Ate ${foodItem.name} (had ${foodItem.count}). Hunger now: ${bot.food}/20`);
      return true;
    } catch (err) {
      logger.warn(MODULE, `Failed to eat ${foodItem.name}: ${err.message}`);
      return false;
    }
  }

  // No food found — ask in chat (only once every 30 seconds to avoid spam)
  const now = Date.now();
  if (!bot._lastFoodAsk || now - bot._lastFoodAsk > 30000) {
    bot._lastFoodAsk = now;
    bot.chat(`I'm starving! (${hunger}/20 hunger) Please give me food!`);
    logger.warn(MODULE, `No food in inventory, asked for food in chat`);
  }

  return false;
}

/**
 * Try to eat until full (useful for stacking food quickly after receiving it).
 * @param {import('mineflayer').Bot} bot
 */
async function eatUntilFull(bot) {
  let attempts = 0;
  while (bot.food < 18 && attempts < 10) {
    const ate = await checkAndEat(bot, 18);
    if (!ate) break;
    attempts++;
    await sleep(300);
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { checkAndEat, eatUntilFull, FOOD_ITEMS };
