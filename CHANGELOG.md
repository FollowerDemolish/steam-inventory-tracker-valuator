# Changelog

All notable changes to Glasscase are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.41] - 2026-10-29

### Added

- Onboarding screen that accepts a profile in any form: profile links, SteamID64, custom URLs, `STEAM_X:Y:Z`, `[U:1:N]`, friend codes and `s.team/p/` invite links. Recent profiles, a "Try the demo" button and a Ctrl/Cmd+K command palette.
- Overview with avatar, account age, Steam level, VAC, trade-ban and limited badges, animated LOWEST, AVG and Net totals, a value sparkline, the most valuable items, a per-game breakdown and honesty warnings (unpriced, non-marketable, skewed averages, spread, thin trading, trade holds and fallbacks).
- Third-party marketplace prices from free, no-key sources: Waxpeer, Market.CSGO (with market.dota2.net, tf2.tm and rust.tm) and Lis-skins floors next to Steam and Skinport, each with a toggle and a configurable seller fee. Whole-game catalogs are fetched once, cached for an hour and looked up locally.
- CSFloat daily sales as an experimental, opt-in second AVG source for the most valuable CS2 items, with the outlier guard applied.
- Currency conversion for USD-only venues through open.er-api.com (cached for 12 hours, rate and date shown wherever used); the demo uses fixed rates.
- LOWEST setting: Steam floor (default), the best floor across enabled marketplaces, or one specific marketplace. AVG source setting: Skinport or Steam sales.
- Item sheet "Marketplaces" table with floor, listings, net after each fee and a link per venue, marking the cheapest place to buy and the best place to sell.
- Overview "By marketplace" card: inventory total at each venue's floor and net after fees, naming where it is worth most in cash and in Steam wallet funds.
- Exit value panel: Instant (net) from Steam buy orders walked for the quantity held (experimental, opt-in), net on Steam (wallet funds), net in cash on the best-paying marketplace and the share of value sellable within 7 days.
- Outlier-guarded AVG: window median and max shown beside the mean, a "skewed" flag, and an opt-in trimmed mean that is always labelled.
- Trade-lock timeline grouped by unlock date; locked items are left out of Instant.
- Inventory grid with real item art, a rarity light and rarity name, wear, LOWEST and AVG, quantity and trade-hold lock; filters for game, rarity, tradable and minimum price, sorting and search.
- Item sheet with Steam and Skinport side by side, all sales windows, buy orders, spread, fees, days to sell and links to the Steam Market and Skinport.
- Library replacement cost with the optional free Steam Web API key, kept apart from the inventory value.
- Local scan history with a value chart, market-event markers and the change since the last scan.
- Share card export (summary and picture grid layouts, four themes, an optional net-by-marketplace line, privacy toggle).
- Settings for currency, price source, AVG window and method, buy orders, liquidity and fee assumptions, games, optional API key and login cookie, cache and motion.
- Caching, per-service throttling, jittered backoff, Retry-After handling and clear rate-limit messages, with cached data served when Steam refuses.
- Offline demo profile with real CS2, Dota 2 and Steam items, icons and prices captured on 2026-10-29.
- Portable builds: Windows portable .exe and Linux AppImage, with data stored next to the executable.
- `--smoke` and `--shots` modes for automated checks and screenshots, and `--record` (`npm run gifs`) to capture the README walkthrough GIFs from the real app.
- README guidance to run Glasscase on a home PC (Windows recommended), since Steam rate-limits datacenter IPs.
