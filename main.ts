// Token Launch Radar — main program (Node 22, standard library only).
//
// Reads the frozen DefiLlama snapshot from /input/snapshot.json (or --input <file|dir>),
// prices every pre-token protocol with the category-multiple model in lib/model.ts,
// writes the ranked board to /output/board.json, writes the dashboard's data to
// /output/data.js, copies this repository's dashboard/ and screenshots/ into /output,
// and finishes by writing /output/summary.json — a deterministic manifest of the
// output (path, size and SHA-256 of every file). The program is deterministic:
// the same snapshot always writes the same bytes.
//
// Local run:  mkdir -p out && OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Output caps, so the program refuses its own output early. */
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read --name <value> or --name=<value> from the arguments, or return the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the frozen /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board that fails validation: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** Copy a directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const pageFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

/** One file in the output manifest. */
interface ManifestFile {
  path: string;
  bytes: number;
  sha256: string;
}

/**
 * Write summary.json into `out`: a deterministic manifest (path, size,
 * SHA-256) of every file the run produced, after enforcing the dashboard
 * caps. Throws with a plain reason when a cap is exceeded.
 */
function writeSummary(outDir: string): void {
  const files: ManifestFile[] = [];
  const walk = (from: string, prefix: string): void => {
    for (const name of readdirSync(from).sort()) {
      if (prefix === '' && name === 'summary.json') continue;
      const path = join(from, name);
      if (statSync(path).isDirectory()) {
        walk(path, `${prefix}${name}/`);
        continue;
      }
      const data = readFileSync(path);
      files.push({ path: `${prefix}${name}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
    }
  };
  walk(outDir, '');
  const dashboard = files.filter((f) => f.path.startsWith('dashboard/'));
  if (dashboard.length > DASHBOARD_CAPS.max_files) {
    throw new Error(`dashboard/ holds ${dashboard.length} files: the cap is ${DASHBOARD_CAPS.max_files}`);
  }
  const dashboardBytes = dashboard.reduce((n, f) => n + f.bytes, 0);
  if (dashboardBytes > DASHBOARD_CAPS.max_bytes) {
    throw new Error(`dashboard/ is ${dashboardBytes} bytes: the cap is ${DASHBOARD_CAPS.max_bytes}`);
  }
  writeFileSync(join(outDir, 'summary.json'), `${JSON.stringify({ schema: 'summary/v1', files }, null, 2)}\n`);
}

// The summary is written last, from the finished output directory.
writeSummary(out);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows ranked (${radar.early_size} early finds below the floor, ${radar.live_size} tokenised set aside)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shots.length} images) and summary.json in ${out}\n`,
);
