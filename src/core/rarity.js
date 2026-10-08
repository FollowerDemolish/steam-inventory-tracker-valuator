// Rarity colours. CS2 uses Valve's grade colours; Dota 2 and TF2 share the
// same palette under different names.

export const RARITY_COLORS = Object.freeze({
  'Consumer Grade': '#b0c3d9',
  'Base Grade': '#b0c3d9',
  'Industrial Grade': '#5e98d9',
  'Mil-Spec Grade': '#4b69ff',
  'Mil-Spec': '#4b69ff',
  'High Grade': '#4b69ff',
  Restricted: '#8847ff',
  Remarkable: '#8847ff',
  Classified: '#d32ce6',
  Exotic: '#d32ce6',
  Covert: '#eb4b4b',
  Extraordinary: '#eb4b4b',
  Contraband: '#e4ae39',
  Common: '#b0c3d9',
  Uncommon: '#5e98d9',
  Rare: '#4b69ff',
  Mythical: '#8847ff',
  Legendary: '#d32ce6',
  Ancient: '#eb4b4b',
  Immortal: '#e4ae39',
  Arcana: '#ade55c',
});

// Rank used for sorting by rarity (higher is rarer).
const RANK = {
  'Consumer Grade': 1, 'Base Grade': 1, Common: 1,
  'Industrial Grade': 2, Uncommon: 2,
  'Mil-Spec Grade': 3, 'Mil-Spec': 3, 'High Grade': 3, Rare: 3,
  Restricted: 4, Remarkable: 4, Mythical: 4,
  Classified: 5, Exotic: 5, Legendary: 5,
  Covert: 6, Extraordinary: 6, Ancient: 6,
  Immortal: 7, Contraband: 7,
  Arcana: 8,
};

export function rarityRank(name) {
  return RANK[name] ?? 0;
}

// Knives and gloves are Covert in Valve's data but are shown in gold in game.
export function displayRarityColor(item) {
  if (item?.name?.startsWith('★')) return '#e4ae39';
  if (item?.rarity?.color) return item.rarity.color;
  if (item?.rarity?.name && RARITY_COLORS[item.rarity.name]) return RARITY_COLORS[item.rarity.name];
  if (item?.nameColor) return item.nameColor;
  return '#8ba3bd';
}

export function normalizeHex(color) {
  if (!color) return null;
  const c = String(color).replace(/^#/, '').trim();
  return /^[0-9a-f]{6}$/i.test(c) ? `#${c.toLowerCase()}` : null;
}
