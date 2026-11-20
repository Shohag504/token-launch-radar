// Token Launch Radar — the value model (radar-2).
//
// The board ranks every pre-token protocol in the sealed snapshot by an implied
// token value that comes only from the snapshot's own figures. Nothing here names
// a protocol: the same code scores every row, and the category multiples are
// measured from the snapshot itself (the live-token protocols it carries), so a
// new snapshot with different figures gives a different board.
//
//   implied = tvl_usd x catMultiple x growthMult x maturityMult x breadthMult
//
//   catMultiple   median market-cap / TVL of the live-token protocols in the
//                 same category (at least 3 of them), clamped to [0.05, 1.5];
//                 categories with too few live names fall back to the median
//                 over every live-token protocol.
//   growthMult    1 + clamp(change_7d, -50, 150) / 100 x 0.6
//   maturityMult  0.7 + min(age_days, 1095) / 1095 x 0.3; 0.85 when the
//                 snapshot gives no listing date.
//   breadthMult   1 + 0.05 x min(chains - 1, 4): a protocol live on more
//                 chains reaches more farmers.

export interface SnapProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-2';
export const LIVE_ROWS = 24;
const DAY_MS = 86_400_000;
const CAT_MIN_SAMPLES = 3;
const MULT_LOW = 0.05;
const MULT_HIGH = 1.5;

export interface ScoredRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  cat_multiple: number;
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  breadth_mult: number;
  on_watchlist: boolean;
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarOut {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: ScoredRow[];
  live: LiveRow[];
}

export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** The middle value of a sorted list (mean of the two middles when even). */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) return 0;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from `listedAt` to the snapshot date; null when the date is missing. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A name ending in a release marker (V2, v2, 2.0 ...) is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** No token recorded at all: no market cap, no CoinGecko id, no symbol. */
export function isPreToken(p: SnapProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A protocol the board may rank: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * The category multiples, measured from the snapshot's own live-token protocols:
 * for each category the median market-cap/TVL of its live names, clamped to
 * [0.05, 1.5]; categories with fewer than 3 live names use the global median.
 */
export function categoryMultiples(snap: Snap): { byCategory: Map<string, number>; global: number } {
  const perCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snap.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorized';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const global = all.length > 0 ? clamp(median(all), MULT_LOW, MULT_HIGH) : 0.25;
  const byCategory = new Map<string, number>();
  for (const [cat, ratios] of perCategory) {
    byCategory.set(cat, ratios.length >= CAT_MIN_SAMPLES ? clamp(median(ratios), MULT_LOW, MULT_HIGH) : global);
  }
  return { byCategory, global };
}

/** The implied value of one protocol, with every multiplier kept for the detail view. */
export function scoreProtocol(
  p: SnapProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, number>; global: number },
): Omit<ScoredRow, 'rank' | 'on_watchlist' | 'farm_steps'> {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = clamp(p.change_7d ?? 0, -50, 150);
  const growthMult = 1 + (growthPct / 100) * 0.6;
  const maturityMult = age === null ? 0.85 : 0.7 + (Math.min(age, 1095) / 1095) * 0.3;
  const breadthMult = 1 + 0.05 * Math.min(Math.max(p.chains.length - 1, 0), 4);
  const catMultiple = multiples.byCategory.get(p.category ?? 'Uncategorized') ?? multiples.global;
  const implied = Math.max(1, Math.round(p.tvl_usd * catMultiple * growthMult * maturityMult * breadthMult));
  return {
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    age_days: age,
    implied_value_usd: implied,
    cat_multiple: round4(catMultiple),
    growth_pct: round4(growthPct),
    growth_mult: round4(growthMult),
    maturity_mult: round4(maturityMult),
    breadth_mult: round4(breadthMult),
  };
}

/** How much capital one farm position takes, from the protocol's own TVL. */
export function capitalFor(p: SnapProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain the protocol names, or a neutral phrase when it names none. */
function chainOf(p: SnapProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/**
 * The main action of the farm plan, picked from the protocol's own category.
 * Every branch is written the same way: what to do, with how much, and where.
 */
export function mainAction(p: SnapProtocol, capital: number): string {
  const c = (p.category ?? '').toLowerCase();
  const chain = chainOf(p);
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Lend $${capital} of USDC into ${name} on ${chain} and leave the deposit earning.`;
  }
  if (c.includes('dex') || c.includes('amm') || c.includes('leveraged farm')) {
    return `Add $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} with ${name}, then put the bridged funds to work in its app.`;
  }
  if (c.includes('stak') || c.includes('restak')) {
    return `Stake $${capital} of the native staking asset through ${name} and hold the receipt token.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  }
  if (c.includes('prediction')) {
    return `Fund your account with $${capital} and take one position in a ${name} market.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or hold $${capital} of the stable asset issued through ${name} on ${chain}.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s yield-bearing asset on ${chain} and hold it.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  }
  if (c.includes('yield')) {
    return `Deposit $${capital} into ${name}'s highest-yield vault on ${chain} and keep it staked.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how
 * long it takes, derived from the protocol's own record (category, chains, TVL,
 * age) — never from a hand-written list of names.
 */
export function farmSteps(p: SnapProtocol, age: number | null): string[] {
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  return [
    `Open a fresh wallet used only for this farm and store its seed phrase offline, never in a screenshot or a chat. (under $3 of gas for the first transaction; about 5 minutes)`,
    `${mainAction(p, capital)} (about $${gas} of gas; about 15 minutes to set up)`,
    `Do one real action every week — a deposit, a swap, a borrow, or a vote — so the activity spans several snapshots. (about $2 of gas a week; about 10 minutes a week)`,
    `Keep the position open for at least ${hold} days; airdrop snapshots reward wallets that stay, not wallets that flash in and out. (the $${capital} stays locked in the position; ${hold} days)`,
    `Check ${p.name}'s own points or rewards page once a week and claim only through links that page itself publishes — never pay anyone to claim for you. (free to check; about 10 minutes)`,
    `Write the wallet address, the dates, and every transaction hash in a farm log, and decide your exit price before any token is announced. (nothing but the log; about 5 minutes)`,
  ];
}

/** The live-token protocols, by market cap, for the dashboard's separate live view. */
export function liveRows(snap: Snap): LiveRow[] {
  return snap.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** The whole radar: the ranked board, the live set, and the model that scored it. */
export function buildRadar(snap: Snap): RadarOut {
  const multiples = categoryMultiples(snap);
  const watchSet = new Set(snap.watchlist);
  const index = new Map(snap.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapProtocol>();
  for (const slug of snap.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: rankable pre-token protocols below the watchlist floor, by TVL.
  const early = snap.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snap.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => scoreProtocol(p, snap.as_of, multiples));
  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const rows: ScoredRow[] = scored.map((s, i) => ({
    ...s,
    rank: i + 1,
    on_watchlist: watchSet.has(s.slug),
    farm_steps: farmSteps(index.get(s.slug)!, s.age_days),
  }));
  const live = liveRows(snap);
  const earlySize = rows.filter((r) => !r.on_watchlist).length;
  return {
    as_of: snap.as_of,
    source: snap.source,
    floor_usd: snap.floor_usd,
    model_version: MODEL_VERSION,
    global_multiple: round4(multiples.global),
    watchlist_size: snap.watchlist.length,
    board_size: rows.length,
    early_size: earlySize,
    live_size: live.length,
    rows,
    live,
  };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapError('snapshot.json has no watchlist of slugs');
  }
  const protocols: SnapProtocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapError(`protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null when it passes every check. */
export function boardIssue(rows: ScoredRow[], snap: Snap): string | null {
  const slugs = new Set(rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (rows.length < 100 || rows.length > 4000) return `the board holds ${rows.length} rows, outside 100..4000`;
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} reads ${ranks[i]}`;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    return `all ${rows.length} rows share implied value $${rows[0]!.implied_value_usd}`;
  }
  for (const r of rows) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} carries ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const n = s.trim().length;
      if (n < 20 || n > 600) return `${r.slug} carries a farm step of ${n} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} carries implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}
