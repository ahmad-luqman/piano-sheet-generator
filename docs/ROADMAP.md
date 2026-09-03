# Roadmap v0.3 — search and progression

Merged from two idea reviews (2026-09-03). Kept what is grounded in the current code and in
verified browser access; dropped what is not. Each phase is independently shippable and
small enough for a few commits. Items marked **Decision** need your call before building.

## Dropped, and why

| Idea | Why not now |
|---|---|
| archive.org as a MIDI source | Search is CORS-open but items are bulk zips and file downloads redirect to a host without CORS. Verified 2026-09-03. |
| freemidi.org, midiworld.com | No CORS. Static site cannot fetch them. |
| OpenScore Lieder corpus | Voice-and-piano songs; weak fit for a keyboard beginner. Mutopia's piano set is the better build-time source. |
| Seven fixed stages | "Hook" is a section choice (absorbed into the steps generator as "start with the most repeated section") and "Rhythm" is a reading-assist toggle, not arrangements. Folded into the three-axis model below. |
| Generic `SearchProvider` interface up front | Only two sources exist (catalog, bitmidi). Introduce the seam when grouping needs it, not before. |
| Arrangement lab (merge tracks from two files), personal hand constraints, ghost hand | Real ideas, but they depend on scoring and analysis that do not exist yet. Parked in Phase F. |

## Guiding idea

Reposition from "a MIDI player with four difficulty buttons" to:

> Find any song, pick the cleanest arrangement, and follow a path from first notes to a performance.

Three axes that are currently mixed together become independent controls:

- **Arrangement**: how many notes and which accompaniment texture.
- **Assistance**: tempo, wait mode, loops, auto-played hand.
- **Reading**: falling notes, letters, finger numbers, notation.

A learner can keep the same arrangement while assistance and reading aids fade out.

LLM rule: the model handles judgment and language; code handles note math. Every call is
opt-in on the user's own key, has a rule-based fallback, and its output is either prose or
a pick from a list that code then generates and verifies. See "LLM features" below.

## Phase A — Search relevance (no new services)

**Status: shipped 2026-09-03.** Items 1–7 landed in `src/search/normalize.ts`, `src/search/rank.ts`,
`src/search/bitmidi.ts` (`searchBitmidiAll`), `src/catalog/songs.ts` (aliases, fuzzy lookup) and
`src/arrange/difficulty.ts`. Ranking weights and difficulty thresholds are marked as decision
points in the code. "Let It Be" now returns the Beatles upload first with seven versions grouped.
The fingerprint is not shown in the UI yet; Phase B puts it on version cards.

Problem: one bitmidi query, page 0 only, provider order, filenames as titles. "Let It Be"
ranks six "Let It Snow" files first (reproduced 2026-09-03). Catalog match is substring only.

1. **Normalize** query and result names: strip `.mid`, underscores, bracketed metadata,
   sequencer credits, "v2"; fold accents and punctuation; split likely title and artist.
2. **Multi-query retrieval**: exact phrase, title plus artist, significant tokens only,
   pages 0 and 1. Run in parallel, merge by id.
3. **Local re-rank**: exact title match, phrase coverage, artist match, popularity.
4. **Group duplicates into songs**: one card per normalized title, "8 versions" expander.
5. **Fuzzy catalog match with aliases** per entry ("Fur Elise" → "Bagatelle No. 25").
6. **Difficulty fingerprint** from parsed notes, as a pure function used by B and D: note
   density, inter-onset interval, pitch range, hand stretch, hand displacement, tempo.
   Separate sub-scores, not one badge. Raw material already exists in
   `simplifyMelodyForBeginner` (median IOI, range).
7. Tests: fixture of raw bitmidi responses with expected order; fingerprint on catalog songs.

Files: `src/search/normalize.ts` (new), `src/search/rank.ts` (new), `src/search/bitmidi.ts`,
`src/catalog/songs.ts`, `src/arrange/difficulty.ts` (new), `src/ui/app.ts`.

## Phase B — "See alternatives" as arrangement comparison

**Status: shipped 2026-09-04.** Items 1–5 landed in `src/search/analyze.ts` (analysis, recommendation
score, sorts, badges, URL-keyed cache), `src/ui/versions.ts` (the card), `src/practice/preview.ts`
(eight-bar sampler preview) and `explainVersions` in `src/llm/claude.ts`. The parser now keeps each
track's General MIDI family and whether the file had drums; instrumentation is judged from those.
Opening a song's versions analyses the top six uploads, three at a time; "Check 6 more" continues.
The recommendation weights and the definition of "closest to original" (the most complete piano
transcription in the group) are marked as a decision point in the code. Verified in a headless
browser against live bitmidi: "Let It Be" shows seven versions, all band files, with the cleanest
hand split and the most confident melody pick starred. The Claude call was checked for shape, not run live.

Problem: users cannot tell which of twelve uploads is the clean piano one without loading it.

1. **Prefetch and analyze** the top N candidates of the selected song group (download,
   parse, run the existing pipeline): valid MIDI, duration, track count, piano-only or
   band, hand split clarity, melody-detection confidence.
2. **Fingerprint badges** from Phase A.6 on each version.
3. **Result card**: recommended version with badges, sort by best match / easiest / closest
   to original / most popular / piano-only.
4. **LLM, optional: version explanation.** One sentence per recommended version built
   from the badges ("cleanest two-hand split, melody confidence high"). Low priority; the
   badges already carry the signal.
5. **Preview**: play the first 8 bars of the Level 1 melody with the sampler before
   committing. Cheap because analysis already parsed the file. A raw-file preview would
   also reveal "this is a band arrangement", but the badges carry that signal.

Files: `src/search/analyze.ts` (new), `src/ui/app.ts`.

## Phase C — Better sources and did-you-mean

1. **LLM: natural-language query understanding.** Fires whenever the query does not look
   like a title ("that sad piano song from Interstellar", "the Beatles one that goes let
   it be"). Returns candidate titles and artists as structured output; code searches
   bitmidi with them. Replaces the current zero-results-only trigger.
2. **Canonical title lookup without an LLM**: iTunes Search (CORS open, about 20 requests
   per minute) or MusicBrainz (CORS open) resolves "yesturday beetles" → "Yesterday, The
   Beatles", then bitmidi is searched with the canonical title. Fills the existing
   `suggestSearchTerms` slot when no API key is set; Claude stays an optional enhancer.
3. **Build-time catalog ingestion**: `scripts/ingest-mutopia.mjs` pulls public-domain piano
   MIDI from Mutopia into the catalog JSON format. No CORS, works offline, hundreds of
   classical pieces on the guaranteed path.

## Phase D — Arrangement ladder

**Status: shipped 2026-09-03.** Decisions taken: six stages (melody, +bass, +fifths, +block chords,
+moving pattern, original piano parts); transposition on by default for stages 1–3 with a toggle;
stages as buttons, slider deferred. Items 1–10 landed in `src/arrange/patterns.ts`, `transpose.ts`,
`ladder.ts`, `suggest.ts`, `levels.ts` (`pianoParts`), `theory.ts` (rule-based chord explanation) and
`src/llm/claude.ts`. Each level now carries its own key and chords. Easing never crosses the
stage 3 → 4 key change. The LLM calls were verified for shape against the SDK types, not run live.

Problem: Level 3 (block chords) to Level 4 (original) is a cliff. The left hand has only
two patterns.

1. **Left-hand pattern ladder** between block chords and original. Candidates, each a
   ten-line generator shaped like `blockChords`: root + fifth, two-note shell (root +
   third or seventh), broken chord, Alberti or waltz bass by meter.
   **Decision 1**: which patterns, in which order.
2. **Transpose to an easy key** at beginner levels: "play in C" or "fewest black keys".
   Key detection already exists. **Decision 2**: on by default for Levels 1–3, or opt-in.
3. **Levels as discrete stages or as a slider**. A slider over the same generator
   parameters (rhythm detail, note density, hand span, accompaniment texture) is UX on
   top of the stages, not a different engine. **Decision 3**: ship stages first, slider
   later, or slider only.
4. **"What changed" view**: when moving up a stage, highlight only the notes, rhythm, or
   chords that were added.
5. **Per-section level**: hard sections rendered one stage lower so the piece is playable
   end to end sooner. Sections and repeats are already detected.
6. **Level 4 becomes "original piano parts"**: melody track plus its named or pitch-split
   partner, not every remaining track. On band MIDIs the current `assignHandsOriginal`
   hands the learner drums-free but still guitar, strings and pads. Part of the cliff.
7. Difficulty fingerprint from Phase A.6 picks the default starting stage and explains why.
8. **Harden the LLM module before adding calls** (`src/llm/claude.ts`): structured outputs
   via `output_config.format` instead of regex JSON extraction; the piece summary in a
   cached system block shared by every call for the same song; low effort for short
   tasks; streaming for the coaching rewrite so steps appear as they arrive; keep the
   refusal check. Small, and everything after it depends on it.
9. **LLM: accompaniment taste.** Per section, the model picks a left-hand pattern from the
   ladder's fixed list given meter, chords and tempo ("3/4 at 112 → waltz bass"). Output
   is an enum; the generators from D.1 produce the notes. Fallback: the default pattern.
10. **LLM: theory on demand.** Click a chord symbol → "why Am here?" answered with the key,
    the melody notes and the bar. Cached per piece. Fallback: the rule-based chord-tone list.

Files: `src/arrange/levels.ts`, `src/arrange/transpose.ts` (new), `src/types.ts`
(`LEVEL_META`), `src/sheet/beginner.ts`, `src/llm/claude.ts`, `src/ui/app.ts`.

## Phase E — Earned, adaptive progression

**Status: shipped 2026-09-04.** Items 1–8 landed in `src/practice/player.ts` (Learn, Rhythm, Perform
modes; per-onset results), `src/practice/match.ts` (timing window), `src/practice/score.ts`
(per-bar, per-hand scoring, error cause, the promotion rule), `src/practice/progress.ts`
(localStorage progress, spaced fragments, daily set, scaffold count), `src/practice/next.ts`
(candidate drills and the rule that picks one), `src/sheet/steps.ts` (the adaptive step replaces
the tempo ramp), `src/ui/progress.ts` and `diagnoseErrors` / `writeJournal` in `src/llm/claude.ts`.
Decision 4 taken: two consecutive clean whole-piece runs at 90% notes and 80% timing, at 80% tempo
or faster, in Rhythm or Perform mode; Learn runs never promote. Reading aids fade automatically,
one per two clean runs, with a "show all aids" button. Review is not a fifth mode: the panel's
"Do it" and today's-set buttons apply the drill (mode, hands, tempo, loop) in one click.
Verified in headless Chrome on Twinkle: a Rhythm lap and a whole-piece Perform lap both scored
clean, the streak read 1 of 2, the bar heat turned green and the record survived a reload
(`scripts/smoke-progress.mjs`). The two Claude calls were checked for shape, not run live.

Problem: `isStepSatisfied` only checks that every required key was eventually pressed.
Timing and wrong notes are ignored, so the app cannot know when a learner is ready.

1. **Practice modes**: Learn (waits, forgiving, current behavior), Rhythm (keeps time,
   scores timing), Perform (no hints, records the attempt), Review (loops problem bars).
2. **Scoring per bar and hand**: note accuracy, timing accuracy, wrong notes, pauses,
   clean repetitions, best clean tempo.
3. **Saved progress** in localStorage per song and stage. No backend.
4. **Adaptive next action** replaces the fixed 60/80/100 ramp in `tempoRamp`: "Practise
   bars 3–4, right hand, at 55%. The G→D jump caused 4 of your 6 errors."
   **Decision 4**: promotion rule, for example two clean runs at 90% notes and 80% timing.
5. **Scaffold fade-out**: after clean repetitions, remove finger numbers, then letters,
   then falling notes, leaving notation.
6. **Trouble-spot queue**: a daily set of short fragments on a spaced schedule: one new,
   one weak, one mastered.
7. **LLM: error diagnosis.** Code supplies per-bar and per-hand statistics plus the list of
   allowed actions (bars, hand, tempo, stage). The model names the cause and picks the
   drill: "four of your six errors are the G→D jump, practise bars 3–4 right hand at 55%".
   The result is a validated `StepAction`. Fallback: the rule-based next action from E.4.
8. **LLM: session journal.** Two sentences at the end of practice: what improved, what to
   do tomorrow. Stored with progress.

Files: `src/practice/match.ts`, `src/practice/score.ts` (new), `src/practice/progress.ts`
(new), `src/sheet/steps.ts`, `src/ui/app.ts`.

## Phase F — Out of the box, after the above

- **Hum or upload audio** via basic-pitch in the browser (TensorFlow.js). Melody-only
  input for Level 1; expect a model download of a few megabytes and rough polyphony.
- **"Playable for you" search**: rank songs against the learner's scores: ready now,
  small stretch, needs two skills.
- **Bridge songs**: recommend a shorter piece that teaches exactly the skill the target
  song needs.
- **Pattern-first learning**: teach the two or three recurring chord shapes and motifs,
  then show where they recur, using the repeat hashing already in `sections.ts`.
- **Ghost hand**: auto-play only the notes the learner keeps missing, hand back as they
  improve.
- **Arrangement lab** and **personal hand constraints** (keyboard size, hand span, revoice
  chords).
- **LLM: next-song and bridge-song recommendations.** Given the learner's skill fingerprint
  and catalog metadata, suggest what to play next and why. Output constrained to catalog ids.
- **LLM: rhythm mnemonics and lyric syllables.** Words aligned to notes so the rhythm is
  felt before it is read. Code checks the syllable count equals the note count.
- **LLM vision: photo of sheet music as input.** A printed melody or lead sheet becomes a
  note list, validated by the pipeline. Rough, but a genuinely new input path.

## LLM features (cross-cutting)

Rules for every call: opt-in on the user's key; rule-based fallback always exists; the
model returns prose or a pick from a list, never pitches or timings; structured outputs
for anything code consumes; piece summary cached per song; low effort for short tasks.

Not for LLMs: key detection, chord detection, quantization, hand assignment, fingering,
scoring. Deterministic, tested, free, and the model is worse at them.

| Feature | Phase | Input from code | Output shape | Fallback |
|---|---|---|---|---|
| Coaching text (exists) | D.8 hardens | steps + piece summary | rewritten step bodies | rule-based steps |
| Accompaniment taste | D.9 | meter, chords, tempo per section | enum from ladder | default pattern |
| Theory on demand | D.10 | key, bar, melody notes, chord | prose | chord-tone list |
| Version explanation | B.4 | analysis badges | one sentence | badges only |
| Error diagnosis | E.7 | per-bar stats, allowed actions | `StepAction` + reason | rule-based next action |
| Session journal | E.8 | session scores | two sentences | none (omit) |
| Query understanding | C.1 | free-text query | title/artist candidates | iTunes/MusicBrainz lookup |
| Recommendations | F | skill fingerprint, catalog | catalog ids + reason | difficulty sort |
| Mnemonics | F | melody notes | syllables per note | none |
| Sheet photo input | F | image | note list | none |

Cost on the user's key: about a cent or two per coaching or diagnosis call, well under
that for the short ones. A full practice session with everything on is a few cents.

## Suggested order

A → D → B → E → C → F. A, D, B and E are shipped; C is next.

Reasoning: A and D each change what a beginner experiences on day one and need no new
services. The fingerprint lands at the end of A so both B and D can use it. E is the largest and
depends on nothing else but benefits from D's stages. C is valuable but is a source
question, not a learning question. LLM work follows the same order: harden the module in
D, then add one call per phase where that phase's data makes it useful.

## Decisions needed before building

1. ~~Left-hand ladder patterns and order (Phase D.1).~~ Six stages, decided 2026-09-03.
2. ~~Transposition default (Phase D.2).~~ On for stages 1–3, toggle in the song bar.
3. ~~Stages first with a slider later, or slider only (Phase D.3).~~ Stages now.
4. ~~Promotion rule thresholds (Phase E.4).~~ Two clean runs at 90/80, ≥80% tempo, timed modes only. Decided 2026-09-04.
5. Confirm the phase order, or pick the first two phases to take.
