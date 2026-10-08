// Library value: what the owned games cost today on the Steam store.

export function summarizeLibrary(games) {
  const totals = { current: 0, full: 0, priced: 0, free: 0, unpriced: 0, hours: 0, games: games.length, currency: null };
  for (const g of games) {
    totals.hours += g.hours ?? 0;
    if (g.price && Number.isFinite(g.price.final)) {
      totals.current += g.price.final;
      totals.full += Number.isFinite(g.price.initial) ? g.price.initial : g.price.final;
      totals.priced += 1;
      totals.currency ??= g.price.currency ?? null;
    } else if (g.free) {
      totals.free += 1;
    } else {
      totals.unpriced += 1;
    }
  }
  totals.perHour = totals.hours > 0 ? totals.full / totals.hours : null;
  return totals;
}

export function sortLibrary(games, by = 'value') {
  const list = games.slice();
  if (by === 'hours') return list.sort((a, b) => (b.hours ?? 0) - (a.hours ?? 0));
  if (by === 'name') return list.sort((a, b) => a.name.localeCompare(b.name));
  return list.sort((a, b) => (b.price?.full ?? b.price?.initial ?? -1) - (a.price?.full ?? a.price?.initial ?? -1));
}
