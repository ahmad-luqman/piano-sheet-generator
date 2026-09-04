#!/usr/bin/env node
/**
 * Build-time catalog ingestion from the Mutopia Project (mutopiaproject.org).
 *
 *   node scripts/ingest-mutopia.mjs [--limit N] [--delay MS] [--force] [--all-licences] [--max-notes N]
 *
 * Pages through Mutopia's solo-piano search results, downloads each single-file .mid into
 * public/catalog/mutopia/ and writes public/catalog/mutopia.json, the metadata index the app
 * fetches at startup. Mutopia has no CORS headers, so this runs at build time; the files
 * are then served from the site itself and work offline. Re-runs are incremental: a file
 * that already exists is not downloaded again unless --force is given.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  DECISION POINT — which Mutopia pieces belong in a beginner's catalog?
 *
 *  Defaults: solo piano only ("for Piano", not "Voice, Piano"), Public Domain only
 *  (Mutopia also hosts CC-BY-SA pieces; including them means showing attribution in
 *  the UI, so they are off unless --all-licences is passed), and single-file works
 *  (multi-movement zips are skipped). --max-notes drops long virtuoso works that a
 *  beginner app has little use for; unset keeps everything.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tonejsMidi from '@tonejs/midi';
const { Midi } = tonejsMidi;
import { parseTable } from './mutopia-table.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', 'catalog', 'mutopia');
const INDEX = path.join(ROOT, 'public', 'catalog', 'mutopia.json');
const BASE = 'https://www.mutopiaproject.org';
const UA = 'piano-sheet-generator ingest (https://github.com/ahmadluqman/piano-sheet-generator)';
const PAGE = 10;

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
const LIMIT = parseInt(opt('--limit', '0'), 10);
const DELAY = parseInt(opt('--delay', '250'), 10);
const MAX_NOTES = parseInt(opt('--max-notes', '0'), 10);
const FORCE = flag('--force');
const ALL_LICENCES = flag('--all-licences');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function listPieces() {
  const all = [];
  for (let start = 0; ; start += PAGE) {
    const url = `${BASE}/cgibin/make-table.cgi?Instrument=Piano&solo=1&startat=${start}`;
    const html = await (await get(url)).text();
    const rows = parseTable(html);
    if (rows.length === 0) break;
    all.push(...rows);
    process.stderr.write(`\rlisted ${all.length} pieces…`);
    if (LIMIT && all.length >= LIMIT) break;
    await sleep(DELAY);
  }
  process.stderr.write('\n');
  return all;
}

function wanted(p) {
  if (p.instrument !== 'Piano') return 'not solo piano';
  if (!ALL_LICENCES && p.licence !== 'Public Domain') return `licence: ${p.licence}`;
  if (!p.midUrl) return p.zipUrl ? 'multi-movement zip' : 'no midi link';
  return null;
}

async function exists(file) { try { await stat(file); return true; } catch { return false; } }

/** bpm, time signature, note count, bars and seconds from the file, via the same parser the app uses. */
function describe(bytes) {
  const midi = new Midi(bytes);
  const bpm = Math.round(midi.header.tempos[0]?.bpm ?? 120);
  const ts = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const ppq = midi.header.ppq || 480;
  let notes = 0, lastTick = 0;
  for (const t of midi.tracks) for (const n of t.notes) { notes++; lastTick = Math.max(lastTick, n.ticks + n.durationTicks); }
  const beats = lastTick / ppq;
  const beatsPerBar = ts[0] * (4 / ts[1]);
  return { bpm, timeSig: { num: ts[0], den: ts[1] }, notes, bars: Math.ceil(beats / beatsPerBar), seconds: Math.round(midi.duration) };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const pieces = await listPieces();
  const skipped = new Map();
  const index = [];
  let downloaded = 0;
  for (const p of pieces) {
    const why = wanted(p);
    if (why) { skipped.set(why, (skipped.get(why) ?? 0) + 1); continue; }
    const file = `${p.slug}.mid`;
    const dest = path.join(OUT_DIR, file);
    let bytes;
    try {
      if (!FORCE && await exists(dest)) {
        bytes = new Uint8Array(await readFile(dest));
      } else {
        const buf = new Uint8Array(await (await get(p.midUrl)).arrayBuffer());
        if (String.fromCharCode(...buf.slice(0, 4)) !== 'MThd') throw new Error('not a MIDI file');
        await writeFile(dest, buf);
        bytes = buf;
        downloaded++;
        await sleep(DELAY);
      }
      const meta = describe(bytes);
      if (meta.notes === 0) throw new Error('no notes');
      if (MAX_NOTES && meta.notes > MAX_NOTES) { skipped.set('over --max-notes', (skipped.get('over --max-notes') ?? 0) + 1); continue; }
      index.push({
        id: `mutopia-${p.slug}`, title: p.title, composer: p.composer, dates: p.dates, opus: p.opus, date: p.date, style: p.style,
        arranger: p.arranger, licence: p.licence, mutopiaId: p.mutopiaId, file, ...meta,
      });
      process.stderr.write(`\r${index.length} ok, ${downloaded} downloaded (${p.slug})            `);
    } catch (err) {
      process.stderr.write(`\nskip ${p.slug}: ${err.message}\n`);
      skipped.set('download/parse error', (skipped.get('download/parse error') ?? 0) + 1);
    }
  }
  index.sort((a, b) => a.composer.localeCompare(b.composer) || a.title.localeCompare(b.title));
  // One piece per line: readable diffs when the run is repeated.
  const head = JSON.stringify({ source: 'The Mutopia Project, https://www.mutopiaproject.org', generated: new Date().toISOString().slice(0, 10), count: index.length });
  await writeFile(INDEX, `${head.slice(0, -1)},\n "pieces": [\n${index.map((p) => '  ' + JSON.stringify(p)).join(',\n')}\n ]}\n`);
  process.stderr.write(`\nwrote ${INDEX}: ${index.length} pieces (${downloaded} new downloads)\n`);
  for (const [why, n] of skipped) process.stderr.write(`  skipped ${n}: ${why}\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
