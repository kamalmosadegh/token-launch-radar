// Token Launch Radar model.
//
// The model prices a token that does not exist yet from the snapshot's own figures.
// Tokenised protocols in the snapshot reveal what the market pays per dollar of TVL in
// each category: the ratio of market cap to TVL. A pre-token protocol is priced at its
// TVL times its category's ratio, with the ratio shrunk toward the global median when
// the category has few tokenised peers, then adjusted for the figures the snapshot
// gives about this protocol alone: its seven-day TVL growth, how long it has run with
// no token, and how many chains it is deployed on. Nothing is priced from a name.

export interface Protocol {
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

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Row {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

export interface RadarRow extends Row {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number;
  multiple: number;
  growth_factor: number;
  age_factor: number;
  reach_factor: number;
  watchlist: boolean;
  peers: number;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  scanned: number;
  pre_token: number;
  live_size: number;
  early_size: number;
  watchlist_size: number;
  global_multiple: number;
  rows: RadarRow[];
}

/** Parse and lightly validate the frozen snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  return raw;
}

/** A protocol records no token when both token fields are null. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * The watchlist test for a wrapped, staked or bridged product of a protocol
 * whose token already trades, applied to any protocol: such a product's own launch
 * would not be a new token, so the radar does not rank it as one.
 */
export function isDerivativeProduct(p: Protocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  const name = p.name;
  if (/\s(V2|v2|2\.0)$/.test(name)) return true;
  if (/\b(wrapped|staked|staking)\b/i.test(name)) return true;
  return EXCHANGE_PREFIXES.some((x) => name.startsWith(x));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

/**
 * What the market pays per TVL dollar in each category, learned only from the
 * snapshot's tokenised protocols. Two guards keep one lucky peer from pricing a
 * whole category: each peer's ratio is winsorised to [0.01, 2.0] before it is
 * learned from (a token trading above twice its protocol's TVL is an outlier, not
 * a pricing rule), and each category median is shrunk toward the global median
 * with weight 6, so a category with a single peer lands near the global figure.
 * Every multiple is kept inside [0.02, 2.0].
 */
export function categoryMultiples(snapshot: Snapshot): { byCategory: Map<string, { multiple: number; peers: number }>; global: number } {
  const ratios: number[] = [];
  const perCategory = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = Math.min(2.0, Math.max(0.01, p.mcap_usd / p.tvl_usd));
    ratios.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const list = perCategory.get(key) ?? [];
    list.push(ratio);
    perCategory.set(key, list);
  }
  const global = median(ratios);
  const byCategory = new Map<string, { multiple: number; peers: number }>();
  for (const [key, list] of perCategory) {
    const shrunk = (list.length * median(list) + 6 * global) / (list.length + 6);
    byCategory.set(key, { multiple: Math.min(2.0, Math.max(0.02, shrunk)), peers: list.length });
  }
  return { byCategory, global };
}

/** Whole days between the day DefiLlama began tracking a protocol and the snapshot date. */
export function ageInDays(p: Protocol, asOf: string): number {
  if (p.listed_at === null) return 0;
  const start = Date.parse(`${p.listed_at}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

const GAS_BY_CHAIN = new Map<string, string>([
  ['Ethereum', 'about $10-30 of ETH for a week of gas'],
  ['Bitcoin', 'about $1-4 of BTC in miner fees'],
  ['Solana', 'under $0.05 of SOL in fees'],
  ['BSC', 'about $0.20-1 of BNB in gas'],
  ['Avalanche', 'about $0.10-1 of AVAX in gas'],
  ['Sui', 'under $0.10 of SUI in fees'],
  ['Aptos', 'under $0.10 of APT in fees'],
]);

/** A plain-language gas estimate for a chain, by the chain's fee tier. */
export function gasFor(chain: string): string {
  const known = GAS_BY_CHAIN.get(chain);
  if (known !== undefined) return known;
  if (/(Arbitrum|Base|Optimism|zkSync|Linea|Scroll|Unichain|Monad|Mantle|Blast|Mode|Taiko)/.test(chain)) {
    return 'about $0.10-1 of gas on this low-fee chain';
  }
  return 'about $0.05-2 of gas on this chain';
}

/** The two product actions of a farm plan, by what the protocol does. */
function productActions(p: Protocol): [string, string] {
  const n = p.name;
  const chain = p.chains[0] ?? 'its main chain';
  switch (p.category) {
    case 'Dexs':
      return [
        `Trade on ${n}: swap $25-100 at a time between its main pairs on ${chain}, two or three swaps a week, so your history shows real use and not one large wash trade.`,
        `Add $100-500 of liquidity to a main pair on ${n} and leave it in place; liquidity providers are the users a launch rewards first, and the position also earns swap fees while it sits.`,
      ];
    case 'Lending':
      return [
        `Supply $100-500 of a main asset (ETH, a stablecoin, or the chain's gas token) to ${n} on ${chain} and keep it supplied; supplied balances are the record a points program reads.`,
        `Borrow a small amount, at most 30% of what you supplied, against that collateral on ${n}, hold it a few days and repay in full, once or twice a month, so both sides of the market show in your history.`,
      ];
    case 'Derivatives':
      return [
        `Open small perpetual positions on ${n}: $50-200 of margin, low leverage, opened and closed over several days each week, aiming for steady volume rather than one large trade.`,
        `Use a second feature of ${n} as well, such as its vaults, limit orders or options desk if it has one, with $50 or more, so your account is a user of the whole product and not one button.`,
      ];
    case 'CDP':
    case 'Dual-Token Stablecoin':
      return [
        `Mint ${n}'s stablecoin against $150-500 of collateral (ETH or a liquid staking token) on ${chain}, and keep the position open with a safe collateral ratio above 200%.`,
        `Use the minted stablecoin inside ${n}'s own ecosystem, for example its stability pool or a partner pool it names, with at least $50, so the mint and the use both show in your history.`,
      ];
    case 'Yield':
    case 'Yield Aggregator':
    case 'Farm':
      return [
        `Deposit $100-500 into a main vault of ${n} on ${chain}, starting with its flagship vault, and leave the deposit in place instead of rotating it for a few points more elsewhere.`,
        `Add a second vault of ${n} with $50-150, or move the same deposit between two of its vaults once a month, so your history covers more of the product than its front page.`,
      ];
    case 'Restaking':
    case 'Staking Pool':
      return [
        `Stake or restake $100-500 of the native asset through ${n} on ${chain} and hold the position; restaked balances held over time are what its points, if it runs one, are counted on.`,
        `Claim and re-stake any rewards ${n} pays out, once a month, and keep the receipts; a compounding history reads as a long-term staker and not a one-day visitor.`,
      ];
    case 'RWA':
      return [
        `Complete ${n}'s onboarding or KYC if it asks for it, then buy $100-500 of its main tokenised asset on ${chain} and hold it; holders of the real-world asset are the launch audience.`,
        `Take part in a second offering or a secondary trade on ${n} with $50 or more when one opens, so your account holds more than its first product.`,
      ];
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return [
        `Deposit $100-500 of stablecoins into a vault curated through ${n} on ${chain}, choosing a vault with a named curator and a track record, and leave it in place for the season.`,
        `Split a second $50-150 across a vault on another chain ${n} curates, if it has one, so your deposits follow the curator and not a single market.`,
      ];
    case 'Basis Trading':
    case 'CeDeFi':
      return [
        `Deposit $100-500 of stablecoins into ${n}'s basis or yield product on ${chain} and hold through at least one full payout cycle, so the holding period is on record.`,
        `Add $50-100 more each month you stay, rather than one lump sum on one day; a growing balance over months reads as conviction when snapshots are taken.`,
      ];
    case 'Payments':
      return [
        `Route real payments through ${n}: pay for two or three things you would buy anyway each month, $20-100 in total, so the account shows genuine payment volume.`,
        `Hold a working balance of $50-200 in ${n} between payments instead of emptying it after each one; average balances are a common measure for payment products.`,
      ];
    case 'Privacy':
      return [
        `Make two or three private transfers a month through ${n} on ${chain}, $25-100 each, using it the way the product is meant to be used and keeping the notes it gives you.`,
        `Hold $50-200 shielded in ${n} between transfers, so your balance history spans the season and not a single afternoon.`,
      ];
    case 'Indexes':
      return [
        `Buy $100-300 of ${n}'s main index product on ${chain} and hold it; index holders are the natural holders of a governance token if one is issued.`,
        `Rebalance or add $25-50 a month to the same index on ${n}, so the account shows a saver adding over time and not a single speculative purchase.`,
      ];
    default:
      return [
        `Use ${n}'s core product on ${chain} with $100-300 at work, two or three times a week: whatever its main action is (deposit, trade, stake or borrow), do that, in sizes a real user would.`,
        `Try a second feature of ${n} with $50 or more, and use it on a second chain it runs on if it has one, so your history covers the product and not only its front page.`,
      ];
  }
}

/**
 * A farm plan for one protocol: five concrete steps with amounts, costs and time.
 * The plan is built from the protocol's own category, main chain and TVL tier,
 * so two protocols never receive the same text unless they truly farm the same way.
 */
export function farmSteps(p: Protocol): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const gas = gasFor(chain);
  const [first, second] = productActions(p);
  const tier = p.tvl_usd >= 1_000_000_000 ? 'one of the largest protocols still without a token' : p.tvl_usd >= 100_000_000 ? 'a large protocol' : 'an early protocol';
  return [
    `Set up a fresh wallet for ${p.name} and fund it on ${chain} with ${gas}; a separate wallet keeps this farm's history clean and caps what a bad contract could ever reach. Cost: one transfer, about 10 minutes.`,
    first,
    second,
    `Stay active for a season: repeat the core action weekly for 8-12 weeks, about 15 minutes a week. ${p.name} is ${tier} (TVL $${Math.round(p.tvl_usd).toLocaleString('en-US')}), and seasons of steady use are what snapshot-based drops measure; one busy day is not.`,
    `Track it weekly: note your balances and actions in a simple log, follow ${p.name}'s official announcements from its own site only, and never pay anyone who promises a guaranteed airdrop. Total budget to cap the farm: your position plus about $30 of fees.`,
  ];
}

/** Score every pre-token candidate and build the ranked board. */
export function buildRadar(snapshot: Snapshot): { board: Row[]; radar: Radar } {
  const { byCategory, global } = categoryMultiples(snapshot);
  const watchlist = new Set(snapshot.watchlist);
  const candidates = snapshot.protocols.filter((p) => recordsNoToken(p) && !isDerivativeProduct(p));

  const scored: RadarRow[] = candidates.map((p) => {
    const entry = byCategory.get(p.category ?? 'Uncategorised') ?? { multiple: global, peers: 0 };
    const growth = p.change_7d === null ? 0 : Math.min(30, Math.max(-30, p.change_7d));
    const growthFactor = 1 + (growth / 100) * 0.6;
    const ageDays = ageInDays(p, snapshot.as_of);
    const ageFactor = Math.min(1.25, 1 + 0.08 * Math.log2(1 + ageDays / 365));
    const reachFactor = 1 + 0.03 * Math.min(Math.max(p.chains.length - 1, 0), 5);
    const implied = Math.max(1, Math.round(p.tvl_usd * entry.multiple * growthFactor * ageFactor * reachFactor));
    return {
      slug: p.slug,
      name: p.name,
      rank: 0,
      implied_value_usd: implied,
      farm_steps: farmSteps(p),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      age_days: ageDays,
      multiple: entry.multiple,
      growth_factor: growthFactor,
      age_factor: ageFactor,
      reach_factor: reachFactor,
      watchlist: watchlist.has(p.slug),
      peers: entry.peers,
    };
  });

  scored.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));

  // The watchlist is the floor: every one of its protocols is on the board, then the
  // strongest early candidates below the floor fill the board out to 220 rows.
  const chosen: RadarRow[] = [];
  const chosenSlugs = new Set<string>();
  for (const row of scored) {
    if (row.watchlist) {
      chosen.push(row);
      chosenSlugs.add(row.slug);
    }
  }
  for (const row of scored) {
    if (chosen.length >= 220) break;
    if (!chosenSlugs.has(row.slug)) {
      chosen.push(row);
      chosenSlugs.add(row.slug);
    }
  }
  chosen.sort((a, b) => b.implied_value_usd - a.implied_value_usd || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1));
  for (let i = 0; i < chosen.length; i++) {
    if (i > 0 && chosen[i]!.implied_value_usd >= chosen[i - 1]!.implied_value_usd) {
      chosen[i]!.implied_value_usd = Math.max(1, chosen[i - 1]!.implied_value_usd - 1);
    }
    chosen[i]!.rank = i + 1;
  }

  const board: Row[] = chosen.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.implied_value_usd,
    farm_steps: r.farm_steps,
  }));

  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    scanned: snapshot.protocols.length,
    pre_token: candidates.length,
    live_size: snapshot.protocols.filter((p) => !recordsNoToken(p)).length,
    early_size: chosen.filter((r) => !r.watchlist).length,
    watchlist_size: snapshot.watchlist.length,
    global_multiple: global,
    rows: chosen,
  };
  return { board, radar };
}

/** The board rules, checked locally so a bad board never leaves the machine. */
export function boardIssue(board: Row[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const slug of snapshot.watchlist) {
    if (!board.some((r) => r.slug === slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  let previous = Number.POSITIVE_INFINITY;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    if (row.rank !== i + 1) return `ranks are not exactly 1 to N: rank ${row.rank} at place ${i + 1}`;
    if (!slugs.has(row.slug)) return `row ${row.slug} is not a protocol in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) return `row ${row.slug} has an implied value outside the allowed range`;
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `row ${row.slug} has ${row.farm_steps.length} farm steps, outside 3 to 12`;
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters, outside 20 to 600`;
    }
  }
  return null;
}

/** The dashboard's data, as a script the static page loads with no network. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
