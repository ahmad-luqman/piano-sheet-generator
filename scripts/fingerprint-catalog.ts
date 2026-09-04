/**
 * Offline pass over the bundled Mutopia MIDI files: run each through the real six-stage
 * pipeline and write the suggested stage, key, and the fingerprint values of every stage
 * into public/catalog/mutopia.json. No network. Built and run by `npm run fingerprint:catalog`
 * (a Vite server build of the TypeScript sources, see vite.ssr.config.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { buildArrangement } from '../src/arrange';
import { fingerprint, fingerprintValues } from '../src/arrange/difficulty';
import { parseMidi } from '../src/midi/parse';
import type { LevelId } from '../src/types';

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'public', 'catalog', 'mutopia.json');
const DIR = path.join(ROOT, 'public', 'catalog', 'mutopia');

interface Piece { id: string; title: string; file: string; [k: string]: unknown }
interface Index { source: string; generated: string; count: number; pieces: Piece[] }

const index = JSON.parse(readFileSync(INDEX, 'utf8')) as Index;
let ok = 0, failed = 0;
for (const p of index.pieces) {
  try {
    const song = parseMidi(new Uint8Array(readFileSync(path.join(DIR, p.file))), p.title, 'catalog');
    const arr = buildArrangement(song);
    const fp: Record<string, number[]> = {};
    for (const id of [1, 2, 3, 4, 5, 6] as LevelId[]) fp[id] = fingerprintValues(fingerprint(arr.levels[id].notes, arr.bpm));
    p.key = arr.key.name;
    p.suggested = arr.suggestedLevel?.level ?? 1;
    p.fp = fp;
    ok++;
    process.stderr.write(`\r${ok} fingerprinted (${p.id})                    `);
  } catch (err) {
    failed++;
    process.stderr.write(`\nskip ${p.id}: ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
const head = JSON.stringify({ source: index.source, generated: index.generated, fingerprinted: new Date().toISOString().slice(0, 10), count: index.pieces.length });
writeFileSync(INDEX, `${head.slice(0, -1)},\n "pieces": [\n${index.pieces.map((p) => '  ' + JSON.stringify(p)).join(',\n')}\n ]}\n`);
process.stderr.write(`\nwrote ${INDEX}: ${ok} fingerprinted, ${failed} failed\n`);
