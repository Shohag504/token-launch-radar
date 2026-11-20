// Token Launch Radar — the entry program (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with the model in
// lib/radar.ts, and writes the grader's outputs:
//
//   /output/board.json     the ranked board (rows 1..N by implied value)
//   /output/data.js        the dashboard's dataset, as one window.RADAR script
//   /output/dashboard/    a copy of this repo's dashboard/
//   /output/screenshots/  a copy of this repo's screenshots/
//   /output/dossier.json  what buildDossier writes from dashboard/ + screenshots/
//
// Deterministic: the same snapshot bytes give the same output bytes, every run.
// No network, no clock, no randomness anywhere in this file.
//
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, boardIssue, parseSnapshot, type RadarOut } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const TEXT_MAX_BYTES = 65_536;

/** One `--flag value` or `--flag=value` argument, else `fallback`. */
function flagValue(argv: string[], flag: string, fallback: string): string {
  const eq = argv.find((a) => a.startsWith(`--${flag}=`));
  if (eq !== undefined) return eq.slice(flag.length + 3);
  const at = argv.indexOf(`--${flag}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const argv = process.argv.slice(2);
const inputGiven = flagValue(argv, 'input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory>`);
}
const outDir = resolve(flagValue(argv, 'output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output'));

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const radar: RadarOut = buildRadar(snapshot);
const issue = boardIssue(radar.rows, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });

/** The dashboard's compact dataset: the board without the long farm-step text. */
function dashboardData(r: RadarOut): object {
  return {
    as_of: r.as_of,
    source: r.source,
    floor_usd: r.floor_usd,
    model_version: r.model_version,
    global_multiple: r.global_multiple,
    watchlist_size: r.watchlist_size,
    board_size: r.board_size,
    early_size: r.early_size,
    live_size: r.live_size,
    rows: r.rows.map((row) => ({
      rank: row.rank,
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains.slice(0, 6),
      chain_count: row.chains.length,
      tvl_usd: row.tvl_usd,
      change_7d: row.change_7d,
      listed_at: row.listed_at,
      age_days: row.age_days,
      implied_value_usd: row.implied_value_usd,
      cat_multiple: row.cat_multiple,
      growth_pct: row.growth_pct,
      growth_mult: row.growth_mult,
      maturity_mult: row.maturity_mult,
      breadth_mult: row.breadth_mult,
      on_watchlist: row.on_watchlist,
    })),
    live: r.live.map((row) => ({
      slug: row.slug,
      name: row.name,
      category: row.category,
      chains: row.chains.slice(0, 6),
      chain_count: row.chains.length,
      tvl_usd: row.tvl_usd,
      mcap_usd: row.mcap_usd,
      change_7d: row.change_7d,
    })),
  };
}

writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: radar.rows })}\n`);
writeFileSync(join(outDir, 'data.js'), `window.RADAR=${JSON.stringify(dashboardData(radar))};\n`);

/** Copy a directory's top-level regular files into `to`, skipping dot-names. */
function copyTop(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

const dashFiles = copyTop(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
if (!dashFiles.includes('index.html') || !dashFiles.some((n) => n.endsWith('.css')) || !dashFiles.some((n) => n.endsWith('.js'))) {
  fail('dashboard/ must hold index.html and at least one .css and one .js file');
}
const shotNames = copyTop(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (shotNames.length < 3) {
  fail(`screenshots/ holds ${shotNames.length} images: hand in 3 — the board, a detail view and a filtered view`);
}
const badName = shotNames.find((n) => !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n));
if (badName !== undefined) fail(`screenshots/${badName}: a name is letters, digits and . _ -, 1 to 128 characters`);

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token-radar: ${radar.board_size} rows (${radar.watchlist_size} watchlist + ${radar.early_size} early), ${radar.live_size} live set aside\n` +
    `token-radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, dashboard (${dashFiles.length} files), screenshots (${shotNames.length}) and dossier.json\n`,
);
