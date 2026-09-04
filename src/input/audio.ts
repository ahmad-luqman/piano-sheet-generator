import type { Song } from '../types';
import { cleanNotes, estimateTempo, notesToSong, TRANSCRIBE, type DetectedNote } from './transcribe';

/**
 * Sound in, notes out, in the browser. Any audio the browser can decode (an iTunes preview,
 * an uploaded file, a microphone take) is resampled to 22.05 kHz mono and run through
 * Spotify's basic-pitch on TensorFlow.js. The library and its 0.9 MB model load on first use
 * only, from this site (public/models/basic-pitch). Results are cached per source.
 */

export type Progress = (phase: 'decode' | 'model' | 'listen', percent: number) => void;

const RATE = 22050;

export async function decodeToMono(data: ArrayBuffer): Promise<Float32Array> {
  const ctx = new AudioContext();
  try {
    const decoded = await ctx.decodeAudioData(data.slice(0));
    const frames = Math.ceil(decoded.duration * RATE);
    const off = new OfflineAudioContext(1, frames, RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return out.getChannelData(0);
  } finally { void ctx.close(); }
}

type Lib = typeof import('@spotify/basic-pitch');
let lib: Promise<Lib> | null = null;
let model: InstanceType<Lib['BasicPitch']> | null = null;

function baseUrl(): string {
  const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  return base.endsWith('/') ? base : `${base}/`;
}

async function load(onProgress?: Progress): Promise<{ lib: Lib; model: InstanceType<Lib['BasicPitch']> }> {
  onProgress?.('model', 0);
  lib ??= import('@spotify/basic-pitch');
  const l = await lib;
  model ??= new l.BasicPitch(`${baseUrl()}models/basic-pitch/model.json`);
  await model.model;
  onProgress?.('model', 100);
  return { lib: l, model };
}

/** Run the model over 22.05 kHz mono samples. */
export async function transcribeSamples(samples: Float32Array, onProgress?: Progress): Promise<DetectedNote[]> {
  const { lib: l, model: m } = await load(onProgress);
  // The model reports one batch at a time; the callback accumulates them.
  const frames: number[][] = [], onsets: number[][] = [], contours: number[][] = [];
  await m.evaluateModel(samples, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, (pct) => onProgress?.('listen', pct));
  const events = l.noteFramesToTime(l.addPitchBendsToNoteEvents(contours, l.outputToNotesPoly(frames, onsets, TRANSCRIBE.onsetThreshold, TRANSCRIBE.frameThreshold, 5)));
  return events.map((e) => ({ start: e.startTimeSeconds, duration: e.durationSeconds, midi: Math.round(e.pitchMidi), amplitude: e.amplitude }));
}

export interface TranscribeOptions { title: string; source: string; cacheKey?: string; onProgress?: Progress }

/** Audio bytes to a Song, through the cache when a key is given. */
export async function transcribeAudio(data: ArrayBuffer, opts: TranscribeOptions): Promise<{ song: Song; notes: number; bpm: number; cached: boolean }> {
  // The cache keeps the model's raw output so a change to TRANSCRIBE applies to cached takes too.
  const hit = opts.cacheKey ? readCache(opts.cacheKey) : undefined;
  let raw: DetectedNote[];
  if (hit) raw = hit.notes;
  else {
    opts.onProgress?.('decode', 0);
    raw = await transcribeSamples(await decodeToMono(data), opts.onProgress);
    if (opts.cacheKey) writeCache(opts.cacheKey, { notes: raw });
  }
  const notes = cleanNotes(raw);
  const bpm = estimateTempo(notes);
  return { song: notesToSong(notes, bpm, opts.title, opts.source), notes: notes.length, bpm, cached: !!hit };
}

/** Record the microphone for `seconds`; `onTick` gets the seconds left. */
export async function recordMicrophone(seconds: number, onTick?: (left: number) => void): Promise<ArrayBuffer> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true } });
  try {
    const rec = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const done = new Promise<void>((resolve) => { rec.onstop = () => resolve(); });
    rec.start();
    for (let left = seconds; left > 0; left--) { onTick?.(left); await new Promise((r) => setTimeout(r, 1000)); }
    rec.stop();
    await done;
    return await new Blob(chunks, { type: rec.mimeType }).arrayBuffer();
  } finally { for (const t of stream.getTracks()) t.stop(); }
}

// ───────────────────────── cache ─────────────────────────

const CACHE_KEY = 'psg.transcriptions.v1';
const CACHE_MAX = 20;
interface Cached { notes: DetectedNote[] }

function readAll(): Record<string, Cached> {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? (JSON.parse(raw) as Record<string, Cached>) : {}; } catch { return {}; }
}
function readCache(key: string): Cached | undefined { return readAll()[key]; }
function writeCache(key: string, value: Cached): void {
  try {
    const all = readAll();
    delete all[key];
    const entries = [...Object.entries(all), [key, value]].slice(-CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* quota or private mode */ }
}
