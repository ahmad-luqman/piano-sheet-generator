import type { RawNote, Song } from '../types';
import { songFromNotes } from '../midi/parse';
import { child, children, parseXml, textOf, type XmlNode } from './xml';

/**
 * MusicXML in, Song out: the notation itself, so a score exported from MuseScore, Sibelius,
 * Finale or Dorico loads exactly. Handles score-partwise with any number of parts, two
 * staves per part (staff 1 → right hand, staff 2 → left hand), chords, ties, backup and
 * forward, tempo and time signature changes (the first of each is used, like MIDI import).
 * Repeats and endings are played once; grace notes and unpitched notes are skipped.
 */

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parseMusicXml(text: string, fallbackTitle = 'MusicXML'): Song {
  const doc = parseXml(text);
  const score = child(doc, 'score-partwise');
  if (!score) throw new Error(child(doc, 'score-timewise') ? 'Timewise MusicXML is not supported; export partwise.' : 'Not a MusicXML score.');
  const title = textOf(score, 'movement-title') || textOf(child(score, 'work'), 'work-title') || fallbackTitle;
  const names = new Map<string, string>();
  for (const sp of children(child(score, 'part-list') ?? { name: '', attrs: {}, children: [], text: '' }, 'score-part')) names.set(sp.attrs.id, textOf(sp, 'part-name'));

  const notes: RawNote[] = [];
  const trackNames: string[] = [];
  let bpm: number | undefined;
  let timeSig: { num: number; den: number } | undefined;
  const parts = children(score, 'part');
  parts.forEach((part, pi) => {
    let divisions = 1;
    let measureStart = 0;
    const partName = names.get(part.attrs.id) || `Part ${pi + 1}`;
    const staves = new Set<number>();
    const pending: RawNote[] = [];   // notes waiting for a tie-stop to lengthen them
    for (const measure of children(part, 'measure')) {
      let cursor = measureStart;
      let maxEnd = measureStart;
      let lastStart = measureStart;
      for (const el of measure.children) {
        switch (el.name) {
          case 'attributes': {
            const d = parseInt(textOf(el, 'divisions'), 10); if (d > 0) divisions = d;
            const t = child(el, 'time');
            if (t && !timeSig) { const num = parseInt(textOf(t, 'beats'), 10), den = parseInt(textOf(t, 'beat-type'), 10); if (num > 0 && den > 0) timeSig = { num, den }; }
            break;
          }
          case 'direction': case 'sound': {
            const s = el.name === 'sound' ? el : child(el, 'sound');
            const t = s ? parseFloat(s.attrs.tempo ?? '') : NaN;
            if (bpm === undefined && t > 0) bpm = Math.round(t);
            break;
          }
          case 'backup': cursor -= dur(el, divisions); break;
          case 'forward': cursor += dur(el, divisions); break;
          case 'note': {
            const d = dur(el, divisions);
            const isChord = !!child(el, 'chord');
            const start = isChord ? lastStart : cursor;
            if (!isChord) { lastStart = cursor; if (!child(el, 'grace')) cursor += d; }
            maxEnd = Math.max(maxEnd, start + d);
            const pitch = child(el, 'pitch');
            if (!pitch || child(el, 'rest') || child(el, 'grace') || d <= 0) break;
            const midi = (parseInt(textOf(pitch, 'octave'), 10) + 1) * 12 + (STEP[textOf(pitch, 'step').toUpperCase()] ?? 0) + Math.round(parseFloat(textOf(pitch, 'alter') || '0'));
            const staff = Math.max(1, parseInt(textOf(el, 'staff') || '1', 10));
            staves.add(staff);
            const track = pi * 2 + (staff - 1);
            const ties = children(el, 'tie').map((t) => t.attrs.type);
            if (ties.includes('stop')) {
              const prev = pending.find((p) => p.track === track && p.midi === midi && Math.abs(p.startBeat + p.durationBeats - start) < 1e-6);
              if (prev) { prev.durationBeats += d; if (!ties.includes('start')) pending.splice(pending.indexOf(prev), 1); break; }
            }
            const v = child(el, 'notations') ? 0.8 : 0.8;
            const note: RawNote = { midi, startBeat: start, durationBeats: d, velocity: v, track };
            notes.push(note);
            if (ties.includes('start')) pending.push(note);
            break;
          }
        }
      }
      measureStart = Math.max(maxEnd, cursor);
    }
    const two = staves.size > 1;
    trackNames[pi * 2] = two ? `${partName} (right hand)` : partName;
    if (two) trackNames[pi * 2 + 1] = `${partName} (left hand)`;
  });
  if (notes.length === 0) throw new Error('The score has no pitched notes.');
  const song = songFromNotes(title, notes, bpm ?? 100, timeSig ?? { num: 4, den: 4 }, 'musicxml');
  song.tracks = song.tracks.map((t) => ({ ...t, name: trackNames[t.index] ?? t.name }));
  return song;
}

function dur(el: XmlNode, divisions: number): number {
  const d = parseFloat(textOf(el, 'duration') || '0');
  return Number.isFinite(d) ? round3(d / divisions) : 0;
}
function round3(x: number): number { return Math.round(x * 1000) / 1000; }

// ───────────────────────── .mxl (zipped MusicXML) ─────────────────────────

/** Read a compressed MusicXML file: META-INF/container.xml names the score, else the first XML in the archive. */
export async function readMxl(data: ArrayBuffer): Promise<string> {
  const entries = await unzip(data);
  const container = entries.get('META-INF/container.xml');
  let path: string | undefined;
  if (container) {
    const root = children(child(child(parseXml(container), 'container') ?? parseXml(container), 'rootfiles') ?? { name: '', attrs: {}, children: [], text: '' }, 'rootfile')[0];
    path = root?.attrs['full-path'];
  }
  if (!path || !entries.has(path)) path = [...entries.keys()].find((k) => !k.startsWith('META-INF/') && /\.(xml|musicxml)$/i.test(k));
  if (!path) throw new Error('No score inside the .mxl file.');
  return entries.get(path)!;
}

/** Minimal zip reader: stored and deflated entries, via the browser's DecompressionStream. */
export async function unzip(data: ArrayBuffer): Promise<Map<string, string>> {
  const bytes = new Uint8Array(data);
  const dv = new DataView(data);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file.');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = new Map<string, string>();
  const td = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/')) continue;
    const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(start, start + csize);
    if (method === 0) out.set(name, td.decode(raw));
    else if (method === 8) out.set(name, td.decode(await inflateRaw(raw)));
    else throw new Error(`Unsupported zip compression (${method}) for ${name}.`);
  }
  return out;
}

async function inflateRaw(raw: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([raw as BlobPart]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** MIDI, MusicXML or .mxl by content, for the upload button and the URL loader. */
export async function readScoreFile(data: ArrayBuffer, name: string): Promise<{ kind: 'midi' | 'musicxml'; xml?: string }> {
  const head = new Uint8Array(data.slice(0, 4));
  const magic = String.fromCharCode(...head);
  if (magic === 'MThd' || magic === 'RIFF') return { kind: 'midi' };
  if (magic.startsWith('PK')) return { kind: 'musicxml', xml: await readMxl(data) };
  const text = new TextDecoder().decode(data.slice(0, 2000));
  if (/<\?xml|<score-partwise|<score-timewise/.test(text) || /\.(xml|musicxml)$/i.test(name)) return { kind: 'musicxml', xml: new TextDecoder().decode(data) };
  throw new Error('That file is not a MIDI, MusicXML or .mxl score.');
}
