import Anthropic from '@anthropic-ai/sdk';
import type { Arrangement, Chord, Level, LevelId, LhPattern } from '../types';
import type { Step } from '../sheet/steps';
import type { SectionPattern } from '../arrange/levels';
import { explainChordRuleBased } from '../arrange/theory';
import { describeVersion, recommendScore, type VersionAnalysis } from '../search/analyze';
import { barQuality } from '../practice/score';
import type { AttemptSummary, StageProgress } from '../practice/progress';
import type { Candidate, NextAction } from '../practice/next';
import type { QueryCandidate } from '../search/canonical';
import type { SkillProfile } from '../practice/skills';
import { METRIC_WORDS } from '../practice/skills';
import { METRIC_KEYS } from '../arrange/difficulty';
import { songFromTranscription, validMnemonics, validPicks, type Mnemonic, type MnemonicRequest, type Pick, type SheetTranscription } from './validate';
import type { Song } from '../types';

/**
 * Every call here follows the same rules: the user's own key, opt-in; a rule-based
 * fallback exists for everything; the model returns prose or a pick from a list, never
 * pitches or timings; anything code consumes is a structured output; the piece summary
 * is one byte-identical system block shared by every call for the same song so it can
 * be served from the prompt cache; short tasks run at low effort.
 */

const KEY_STORAGE = 'psg.anthropicKey';
const MODEL = 'claude-opus-5';

export function getApiKey(): string | null {
  try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
}
export function setApiKey(key: string | null): void {
  try { key ? localStorage.setItem(KEY_STORAGE, key) : localStorage.removeItem(KEY_STORAGE); } catch { /* private mode */ }
}

function client(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('No Anthropic API key set. Add one in Settings.');
  // The key is the user's own and lives only in their browser; direct browser access is intentional.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

function textOf(res: Anthropic.Message): string {
  return res.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('');
}

function checkRefusal(res: Anthropic.Message): void {
  if (res.stop_reason === 'refusal') throw new Error('The model declined this request.');
  if (res.stop_reason === 'max_tokens') throw new Error('The model ran out of room; try again.');
}

// ───────────────────────── piece summary (cached per song) ─────────────────────────

const summaries = new WeakMap<Arrangement, string>();

/** Stable description of the piece: built from the arrangement only, never the level or the steps. */
export function pieceSummary(arr: Arrangement): string {
  let s = summaries.get(arr);
  if (s) return s;
  s = JSON.stringify({
    title: arr.title, key: arr.key.name, bpm: arr.bpm, timeSignature: `${arr.timeSig.num}/${arr.timeSig.den}`,
    bars: arr.totalBars,
    chords: arr.chords.map((c) => ({ bar: Math.floor(c.startBeat / arr.beatsPerBar) + 1, name: c.name })),
    sections: arr.sections.map((sec) => ({ label: sec.label, bars: `${sec.startBar + 1}-${sec.endBar + 1}`, repeatOf: sec.repeatOf })),
  });
  summaries.set(arr, s);
  return s;
}

const TEACHER = 'You are a patient piano teacher writing for an adult self-learner who cannot read sheet music. ' +
  'The piece you are working on is described in this JSON, produced by the app from the MIDI file:\n';

function systemBlocks(arr: Arrangement, task: string): Anthropic.TextBlockParam[] {
  return [
    { type: 'text', text: TEACHER + pieceSummary(arr), cache_control: { type: 'ephemeral' } },
    { type: 'text', text: task },
  ];
}

const obj = (properties: Record<string, unknown>, required = Object.keys(properties)) =>
  ({ type: 'object', properties, required, additionalProperties: false });

// ───────────────────────── coaching rewrite (streamed) ─────────────────────────

const STEPS_SCHEMA = obj({
  steps: { type: 'array', items: obj({ index: { type: 'integer' }, title: { type: 'string' }, body: { type: 'string' } }) },
});

interface StepPatch { index: number; title?: string; body: string }

/**
 * Rewrite the rule-based steps with friendlier coaching, keeping the actions intact.
 * `onProgress` fires as each rewritten step arrives so the panel fills in while the model writes.
 */
export async function enrichSteps(
  arr: Arrangement, levelId: LevelId, steps: Step[],
  onProgress?: (done: Step[], count: number, total: number) => void,
): Promise<Step[]> {
  const c = client();
  const level = arr.levels[levelId];
  const out = steps.map((s) => ({ ...s }));
  const apply = (it: StepPatch) => { const t = out[it.index]; if (t && typeof it.body === 'string') { t.body = it.body; if (it.title) t.title = it.title; } };
  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    output_config: { format: { type: 'json_schema', schema: STEPS_SCHEMA }, effort: 'medium' },
    system: systemBlocks(arr,
      'You will receive the stage the learner is on and a list of practice steps generated by rules. ' +
      'Rewrite each step body in warm, concrete, plain language (2-4 sentences): what to do, what to listen for, one common mistake to avoid. ' +
      'Keep every note name and bar number exactly as given. Do not add or remove steps. Return the steps in order.'),
    messages: [{ role: 'user', content: JSON.stringify({
      stage: `${levelId} - ${level.name}`, keyAtThisStage: level.key.name, chordsAtThisStage: [...new Set(level.chords.map((ch) => ch.name))],
      steps: steps.map((s, i) => ({ index: i, title: s.title, body: s.body })),
    }) }],
  });
  let buffer = '';
  let done = 0;
  const seen = new Set<number>();
  stream.on('text', (delta) => {
    buffer += delta;
    for (const it of completeObjects<StepPatch>(buffer)) {
      if (seen.has(it.index)) continue;
      seen.add(it.index); apply(it); done++;
      onProgress?.(out.map((s) => ({ ...s })), done, steps.length);
    }
  });
  const res = await stream.finalMessage();
  checkRefusal(res);
  const parsed = JSON.parse(textOf(res)) as { steps: StepPatch[] };
  for (const it of parsed.steps) apply(it);
  return out;
}

/**
 * Pull every complete top-level-array element out of a partial JSON document shaped
 * {"steps":[{...},{...}, ...  — enough to repaint as the model streams.
 */
export function completeObjects<T>(partial: string): T[] {
  const out: T[] = [];
  const start = partial.indexOf('[');
  if (start < 0) return out;
  let depth = 0, inStr = false, esc = false, objStart = -1;
  for (let i = start + 1; i < partial.length; i++) {
    const ch = partial[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{') { if (depth === 0) objStart = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && objStart >= 0) { try { out.push(JSON.parse(partial.slice(objStart, i + 1)) as T); } catch { /* not yet */ } objStart = -1; } }
    else if (ch === ']' && depth === 0) break;
  }
  return out;
}

// ───────────────────────── query understanding ─────────────────────────

const QUERY_SCHEMA = obj({
  candidates: { type: 'array', items: obj({ title: { type: 'string' }, artist: { type: 'string' }, reason: { type: 'string' } }) },
});

/**
 * "that sad piano song from Interstellar" → candidate titles and artists. The model does the
 * language and the guessing; code then searches the MIDI site with each candidate and
 * verifies there is a file. Without a key, search/canonical.ts asks iTunes instead.
 */
export async function understandQuery(query: string): Promise<QueryCandidate[]> {
  const c = client();
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 800,
    output_config: { format: { type: 'json_schema', schema: QUERY_SCHEMA }, effort: 'low' },
    system: 'The user is looking for a song to learn on piano and typed a description, a lyric fragment, a nickname or a misspelling ' +
      'instead of a title. Name up to 5 real songs or pieces they most likely mean, most likely first. Give the title and the artist ' +
      'or composer exactly as commonly written in English (for classical works the common name, e.g. "Moonlight Sonata"), and a reason of ' +
      'at most eight words. Never invent a song; if only one fits, return one.',
    messages: [{ role: 'user', content: query }],
  });
  if (res.stop_reason === 'refusal') return [];
  const parsed = JSON.parse(textOf(res)) as { candidates: { title: string; artist: string; reason: string }[] };
  return parsed.candidates
    .filter((x) => typeof x.title === 'string' && x.title.trim())
    .slice(0, 5)
    .map((x) => ({ title: x.title.trim(), artist: x.artist?.trim() || undefined, reason: x.reason?.trim() || undefined, source: 'claude' as const }));
}

// ───────────────────────── accompaniment taste (stage 5) ─────────────────────────

const STAGE5_PATTERNS: LhPattern[] = ['broken', 'alberti', 'waltz'];

const ACCOMP_SCHEMA = obj({
  sections: { type: 'array', items: obj({ section: { type: 'integer' }, pattern: { type: 'string', enum: STAGE5_PATTERNS }, reason: { type: 'string' } }) },
});

export interface AccompanimentChoice extends SectionPattern { section: number; reason: string }

/**
 * Per section, pick a stage-5 left-hand texture from the fixed list. The model chooses
 * and explains; the generators in arrange/patterns.ts produce the notes. Sections that
 * repeat an earlier one inherit its pattern. Anything off-list falls back to `fallback`.
 */
export async function chooseAccompaniment(arr: Arrangement, fallback: LhPattern): Promise<AccompanimentChoice[]> {
  const c = client();
  const originals = arr.sections.filter((s) => s.repeatOf === undefined);
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 2000,
    output_config: { format: { type: 'json_schema', schema: ACCOMP_SCHEMA }, effort: 'low' },
    system: systemBlocks(arr,
      'For each section listed, choose the left-hand accompaniment pattern a teacher would write for a learner at the "moving left hand" stage. ' +
      'Options: "waltz" (root then two chord beats; suits triple meter), "alberti" (low-high-middle-high eighths; suits moderate tempos and steady harmony), ' +
      '"broken" (root-third-fifth-octave; suits fast tempos, compound meter, or a busy melody). Give a reason of at most twelve words per section.'),
    messages: [{ role: 'user', content: JSON.stringify({
      meter: `${arr.timeSig.num}/${arr.timeSig.den}`, bpm: arr.bpm,
      sections: originals.map((s) => ({
        section: s.index, label: s.label, bars: `${s.startBar + 1}-${s.endBar + 1}`,
        chords: arr.chords.filter((ch) => ch.startBeat >= s.startBar * arr.beatsPerBar && ch.startBeat < (s.endBar + 1) * arr.beatsPerBar).map((ch) => ch.name),
        melodyNotesPerBar: Math.round(arr.levels[4].notes.filter((n) => n.hand === 'rh' && n.startBeat >= s.startBar * arr.beatsPerBar && n.startBeat < (s.endBar + 1) * arr.beatsPerBar).length / (s.endBar - s.startBar + 1)),
      })),
    }) }],
  });
  checkRefusal(res);
  const parsed = JSON.parse(textOf(res)) as { sections: { section: number; pattern: string; reason: string }[] };
  const byIndex = new Map<number, { pattern: LhPattern; reason: string }>();
  for (const it of parsed.sections) {
    const pattern = STAGE5_PATTERNS.includes(it.pattern as LhPattern) ? (it.pattern as LhPattern) : fallback;
    byIndex.set(it.section, { pattern, reason: it.reason ?? '' });
  }
  return arr.sections.map((s) => {
    const pick = byIndex.get(s.repeatOf ?? s.index) ?? { pattern: fallback, reason: 'default' };
    return { section: s.index, start: s.startBar * arr.beatsPerBar, end: (s.endBar + 1) * arr.beatsPerBar, ...pick };
  });
}

// ───────────────────────── theory on demand ─────────────────────────

const explanations = new Map<string, string>();

/** "Why Am here?" answered from the key, the bar and the melody. Cached per piece, key, chord and bar. */
export async function explainChord(arr: Arrangement, level: Level, chord: Chord, bar: number): Promise<string> {
  const cacheKey = `${arr.title}|${arr.totalBars}|${arr.melodyTrack}|${level.key.name}|${chord.name}|${bar}`;
  const hit = explanations.get(cacheKey);
  if (hit) return hit;
  const c = client();
  const facts = explainChordRuleBased(level, chord, bar, arr.beatsPerBar);
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 400,
    output_config: { effort: 'low' },
    system: systemBlocks(arr,
      'The learner clicked a chord symbol and asked why that chord is there. Answer in two or three plain sentences using the facts given: ' +
      'name its role in the key, say how the melody notes in that bar relate to it, and mention the chord before or after only if it explains the choice. No jargon beyond chord names and scale degrees.'),
    messages: [{ role: 'user', content: JSON.stringify({ bar: bar + 1, keyAtThisStage: level.key.name, chord: chord.name, facts }) }],
  });
  checkRefusal(res);
  const text = textOf(res).trim() || facts;
  explanations.set(cacheKey, text);
  return text;
}

// ───────────────────────── version explanation (search results) ─────────────────────────

const VERSIONS_SCHEMA = obj({ versions: { type: 'array', items: obj({ id: { type: 'string' }, sentence: { type: 'string' } }) } });

/**
 * One sentence per analysed upload of a song, written from the badges alone: what kind of
 * file it is and who it suits. Input is the badge data code already computed; the model
 * adds no facts about the file. Returns a map from version id to sentence.
 */
export async function explainVersions(title: string, artist: string | undefined, analyses: VersionAnalysis[]): Promise<Map<string, string>> {
  const c = client();
  const ranked = [...analyses].sort((a, b) => recommendScore(b) - recommendScore(a));
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 1500,
    output_config: { format: { type: 'json_schema', schema: VERSIONS_SCHEMA }, effort: 'low' },
    system: 'A beginner searched a MIDI site for a song and the app downloaded and analysed several uploads of it. ' +
      'For each version write one plain sentence of at most twenty words saying what kind of file it is and whether a beginner should pick it, ' +
      'using only the badges given. The first version listed is the app\'s recommendation. Do not invent anything about the files.',
    messages: [{ role: 'user', content: JSON.stringify({
      song: artist ? `${title} (${artist})` : title,
      versions: ranked.map((a, i) => ({ id: a.id, fileName: a.name, recommended: i === 0, badges: describeVersion(a).map((b) => b.text) })),
    }) }],
  });
  checkRefusal(res);
  const parsed = JSON.parse(textOf(res)) as { versions: { id: string; sentence: string }[] };
  const ids = new Set(analyses.map((a) => a.id));
  return new Map(parsed.versions.filter((v) => ids.has(v.id) && typeof v.sentence === 'string').map((v) => [v.id, v.sentence.trim()]));
}

// ───────────────────────── error diagnosis (practice) ─────────────────────────

const DIAGNOSIS_SCHEMA = obj({ choice: { type: 'integer' }, cause: { type: 'string' } });

/**
 * Name the cause of the learner's errors and pick the drill. Code supplies the bar and
 * hand statistics and a fixed list of candidate actions; the model returns an index
 * into that list plus one sentence. Anything off the list falls back to the rule's pick.
 */
export async function diagnoseErrors(arr: Arrangement, levelId: LevelId, stage: StageProgress, next: NextAction): Promise<{ candidate: Candidate; cause: string }> {
  const c = client();
  const bars = Object.entries(stage.bars)
    .map(([k, b]) => ({ bar: parseInt(k, 10) + 1, hand: k.endsWith('rh') ? 'right' : 'left', quality: Math.round(barQuality(b) * 100), notes: Math.round(b.notes), hits: Math.round(b.hits), wrong: Math.round(b.wrong), onTime: b.timed ? Math.round(100 * b.onTime / b.timed) : null, pauses: Math.round(b.pauses) }))
    .sort((a, b) => a.quality - b.quality).slice(0, 8);
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 600,
    output_config: { format: { type: 'json_schema', schema: DIAGNOSIS_SCHEMA }, effort: 'low' },
    system: systemBlocks(arr,
      'The learner has practised this piece and the app scored each bar. Say in one plain sentence (at most 25 words) what is causing most of the errors, ' +
      'then choose the drill from the numbered candidates by its index. Prefer the smallest drill that targets the cause. Use only the statistics given.'),
    messages: [{ role: 'user', content: JSON.stringify({
      stage: `${levelId} - ${arr.levels[levelId].name}`,
      weakestBars: bars,
      frequentErrors: Object.values(stage.causes).sort((a, b) => b.count - a.count).slice(0, 5).map((x) => ({ where: x.label, bar: x.bar + 1, weight: x.count })),
      recentAttempts: stage.attempts.slice(-5).map((a) => ({ mode: a.mode, bars: `${a.startBar + 1}-${a.endBar + 1}`, tempo: a.tempoScale, notes: a.noteAccuracy, timing: a.timingAccuracy, wrong: a.wrong, clean: a.clean })),
      candidates: next.candidates.map((cand, i) => ({ index: i, drill: cand.title, why: cand.reason })),
    }) }],
  });
  checkRefusal(res);
  const parsed = JSON.parse(textOf(res)) as { choice: number; cause: string };
  const candidate = Number.isInteger(parsed.choice) && next.candidates[parsed.choice] ? next.candidates[parsed.choice] : next;
  return { candidate, cause: (typeof parsed.cause === 'string' && parsed.cause.trim()) || candidate.reason };
}

// ───────────────────────── session journal ─────────────────────────

/** Two sentences at the end of practice: what improved, what to do tomorrow. */
export async function writeJournal(arr: Arrangement, levelId: LevelId, attempts: AttemptSummary[], next: NextAction): Promise<string> {
  const c = client();
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 300,
    output_config: { effort: 'low' },
    system: systemBlocks(arr,
      'Write the learner\'s practice journal entry for today: exactly two sentences, warm and specific. First what improved or what they did, second what to do tomorrow, ' +
      'consistent with the suggested next drill. No headings, no bullet points, no more than 45 words in total.'),
    messages: [{ role: 'user', content: JSON.stringify({
      stage: `${levelId} - ${arr.levels[levelId].name}`,
      attemptsToday: attempts.map((a) => ({ mode: a.mode, bars: `${a.startBar + 1}-${a.endBar + 1}`, tempo: a.tempoScale, notes: a.noteAccuracy, timing: a.timingAccuracy, wrong: a.wrong, clean: a.clean, cause: a.cause })),
      nextDrill: { title: next.title, reason: next.reason },
    }) }],
  });
  checkRefusal(res);
  return textOf(res).trim();
}

// ───────────────────────── what to play next (Phase F) ─────────────────────────

const PICKS_SCHEMA = obj({ picks: { type: 'array', items: obj({ id: { type: 'string' }, reason: { type: 'string' } }) } });

export interface RecommendCandidate { id: string; title: string; composer: string; bars: number; fit: string; suggested: number }

/**
 * Three pieces to play next, chosen from a shortlist code already judged playable or a
 * small stretch. The model adds taste and a reason; ids off the list are dropped, and an
 * empty answer means the caller keeps the readiness order.
 */
export async function recommendSongs(profile: SkillProfile, recent: { title: string; stage: number; clean: boolean }[], shortlist: RecommendCandidate[]): Promise<Pick[]> {
  const c = client();
  const skills = profile.values ? METRIC_KEYS.map((k, i) => `${k}: ${profile.values![i]}`).join(', ') : 'nothing credited yet';
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 500,
    output_config: { format: { type: 'json_schema', schema: PICKS_SCHEMA }, effort: 'low' },
    system: 'You are a piano teacher choosing the next piece for a self-taught beginner. Pick up to 3 from the shortlist only, by id, most suitable first. ' +
      'Prefer variety over what they just played, a piece that builds on a small stretch over one that is merely easy, and something short. ' +
      'Give a reason of at most 15 words that a learner would find motivating. Never invent an id.',
    messages: [{ role: 'user', content: JSON.stringify({ skillsPlayedClean: skills, recentlyPlayed: recent, shortlist }) }],
  });
  checkRefusal(res);
  return validPicks(JSON.parse(textOf(res)), new Set(shortlist.map((s) => s.id)));
}

// ───────────────────────── rhythm mnemonics (Phase F) ─────────────────────────

const WORDS_SCHEMA = obj({ sections: { type: 'array', items: obj({ section: { type: 'integer' }, words: { type: 'string' } }) } });

/**
 * Words to say while playing each right-hand section, one syllable per note, hyphenated.
 * Code counts the syllables and drops any section where the count is wrong.
 */
export async function rhythmWords(arr: Arrangement, sections: (MnemonicRequest & { label: string; bars: string; letters: string; rhythm: string })[]): Promise<Mnemonic[]> {
  const c = client();
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 800,
    output_config: { format: { type: 'json_schema', schema: WORDS_SCHEMA }, effort: 'low' },
    system: systemBlocks(arr,
      'Write a short phrase to say aloud while playing each section so the rhythm is felt before it is read. Exactly one syllable per note, ' +
      'in order, with every multi-syllable word hyphenated (twin-kle). Long notes get a stressed or open syllable, short notes a light one. ' +
      'Plain, friendly words; a lyric from the actual song is best when one exists. Return the section index and the words.'),
    messages: [{ role: 'user', content: JSON.stringify({ sections }) }],
  });
  checkRefusal(res);
  return validMnemonics(JSON.parse(textOf(res)), sections);
}

// ───────────────────────── sheet photo (Phase F) ─────────────────────────

const SHEET_SCHEMA = obj({
  title: { type: 'string' }, bpm: { type: 'integer' }, timeSig: obj({ num: { type: 'integer' }, den: { type: 'integer' } }),
  rh: { type: 'string' }, lh: { type: 'string' }, notes: { type: 'string' },
});

const DSL_HELP = 'Note DSL, whitespace separated: C4 (one beat), G4:2 (two beats), F#5:0.5 (half a beat), Bb3:1.5, r:1 (rest), [C3 E3 G3]:2 (chord), | (bar line, optional). ' +
  'Middle C is C4. Beats are quarter notes. Write the melody line (top staff, right hand) as `rh`. Write the bass staff as `lh` only if it is clearly readable, else leave it empty. ' +
  'Put any doubt (a blurry bar, a guessed key signature) in `notes`.';

/**
 * A photo of printed sheet music becomes a melody. The model writes the catalog DSL and
 * parseDsl validates every token; anything it cannot parse rejects the whole answer.
 * Rough by design: a lead sheet or a simple melody, not a full score.
 */
export async function readSheetPhoto(file: { data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' }, page?: { index: number; count: number; previous?: SheetTranscription }): Promise<{ song: Song; notes?: string; transcription: SheetTranscription }> {
  const c = client();
  const pageNote = page && page.count > 1
    ? ` This is page ${page.index + 1} of ${page.count}.` + (page.previous ? ` The previous page ended in ${page.previous.timeSig.num}/${page.previous.timeSig.den} at ${page.previous.bpm} bpm; keep the same title, tempo and meter, and transcribe only the bars on this page, in order.` : '')
    : '';
  const res = await c.messages.create({
    model: MODEL,
    max_tokens: 3000,
    output_config: { format: { type: 'json_schema', schema: SHEET_SCHEMA }, effort: 'medium' },
    system: 'Transcribe the sheet music in the photo. ' + DSL_HELP + ' Use the printed tempo if there is one, else a sensible one for the style. Never invent bars you cannot see.',
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: file.mediaType, data: file.data } },
      { type: 'text', text: `Transcribe this.${pageNote}` },
    ] }],
  });
  checkRefusal(res);
  const parsed = JSON.parse(textOf(res)) as SheetTranscription;
  const song = songFromTranscription(parsed);
  return { song, notes: parsed.notes?.trim() || undefined, transcription: parsed };
}
