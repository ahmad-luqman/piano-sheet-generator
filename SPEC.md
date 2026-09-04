# Piano Sheet Generator — Specification (v0.2, decisions locked)

## 1. Goal

A browser app for beginners and self-learners who cannot read standard sheet music.
Type a song name, get a playable arrangement at several difficulty levels, and learn it
by following along on a 3D piano that plays audio. Standard notation is available for
advanced players but is secondary.

Primary user: someone with a keyboard at home, no theory background, who wants
"which key do I press, in what order, with which hand".

## 2. User flow

1. Type a song name (or upload a `.mid`, paste a MIDI URL, or pick from the bundled catalog).
2. Pick a result from the search list (shows name, popularity, duration once loaded).
3. Choose a level: **1 Melody · 2 Melody + Bass · 3 Melody + Chords · 4 Original**.
4. Main screen: beginner sheet on top, 3D piano with falling notes below, controls bar.
5. Modes: **Listen** (auto-play, keys light up), **Practice** (waits for the right keys),
   **Free play** (just a piano).
6. "How to play" side panel: numbered steps generated from the arrangement.

## 3. Input sources

| Source | Status | Notes |
|---|---|---|
| bitmidi.com search API | Verified working, CORS `*` on search and downloads | `GET /api/midi/search?q=&page=` → `downloadUrl`. User-uploaded content, best effort. |
| MIDI file upload | Planned | Drag and drop or file picker. |
| MIDI URL paste | Planned | Only works if the host allows CORS. Show a clear error if not. |
| Bundled public-domain catalog | Shipped | 8 hand-entered pieces in a text note DSL (`src/catalog/songs.ts`) plus 259 solo-piano MIDI files from the Mutopia Project pulled at build time by `scripts/ingest-mutopia.mjs` into `public/catalog/` with a JSON index. Works offline and demos without copyright ambiguity. |
| iTunes Search, MusicBrainz | Shipped | Both CORS-open. Resolve misspellings and descriptions to canonical titles when MIDI search finds little; bitmidi is then searched with the title. |

Because bitmidi is CORS-open there is **no backend**. The app is a static site.

## 4. Arrangement pipeline (the core)

Input: MIDI bytes → `@tonejs/midi` → tracks of `{midi, time, duration, velocity}`.

1. **Normalize**: merge tempo map into seconds and beats; read time signature (default 4/4);
   drop percussion (channel 10) and empty tracks.
2. **Key detection**: Krumhansl–Schmuckler pitch-class profile correlation over the whole
   piece. Output: tonic + major/minor. Used for note spelling (F# vs Gb) and chord naming.
3. **Melody track selection** (heuristic, with manual override in the UI):
   score = mean pitch (higher is better) + monophony ratio + note count weight; penalize
   tracks that are mostly sustained chords. If a track is polyphonic, take the top voice.
4. **Chord detection per bar** (and per half-bar if the bar's harmony clearly changes):
   pitch-class histogram weighted by duration, matched against major, minor, dim, aug,
   dom7, maj7, min7 templates; prefer bass-note root when ambiguous; smooth so a chord
   must last at least half a bar.
5. **Levels** derived from (melody, chords, original):
   - **L1 Melody**: right hand only. Quantize to the nearest eighth, drop grace notes and
     ornaments shorter than a 16th, collapse the range to fit in one octave plus a fifth
     where possible (octave-shift outliers).
   - **L2 Melody + Bass**: L1 plus left hand plays the chord root as a whole/half note per
     chord change, one octave below middle C.
   - **L3 Melody + Chords**: L1 (less quantization) plus left hand block triads in root
     position, rhythm: one hit per chord change, plus one on beat 3 in 4/4.
   - **L4 Original**: the MIDI as written, both hands split at middle C if the file does
     not separate hands.
6. **Hand assignment** for L4: track names ("left"/"right"), else pitch split at C4 with
   hysteresis.
7. **Finger hints** (beginner levels only): simple five-finger position heuristic. Place
   thumb on the lowest note of each phrase, assign 1–5 by scale degree, re-position when
   the phrase exceeds a fifth. Marked as "suggested", not authoritative.
8. **Sections**: split into 4-bar (or 8-bar) chunks for the step list; detect repeats by
   hashing bars so steps can say "bars 9–12 are the same as 1–4".

Output: a single `Arrangement` object:
```
{ title, key, tempoBpm, timeSig, bars: Bar[], levels: { 1..4: { rh: Note[], lh: Note[] } },
  chords: { bar, beat, name, pitches }[], sections: Section[] }
Note = { midi, startBeat, durationBeats, hand, finger?, letter, octave }
```

## 5. Sheet outputs

### 5a. Beginner sheet (default)
- Horizontal bars, one row of 4 bars. Each note is a colored pill with its **letter name**
  (C D E F G A B, with # / b as small superscript) and octave marker for out-of-range notes.
- Right hand row above, left hand row below, aligned to a beat grid so duration is visible
  as pill width. Rests shown as gaps.
- **Chord name** above each bar segment (e.g., `C`, `Am`, `G7`) and, on hover, the keys
  that make the chord.
- Finger numbers (1–5) under notes at L1–L3.
- Current position highlighted during playback; click a bar to seek.
- Color scheme: one color per pitch class on the sheet (so letters and colors become associated); the 3D piano uses hand colors instead (blue = right, orange = left) because there the question is "which hand", not "which letter".

### 5b. Advanced sheet (toggle)
- Grand staff standard notation rendered by **abcjs** from generated ABC text: treble +
  bass voices, key signature, chord symbols as annotations, bar numbers.
- Cursor follows playback via abcjs timing callbacks.

### 5c. How-to-play steps (generated, rule based)
1. "Find middle C" with a picture of the keyboard region used.
2. Hand position: "Right hand thumb on C4 …".
3. Learn the right hand, section by section, at 50% tempo. Each step names the bars and
   the letter sequence.
4. Learn the left hand chords: list each chord with its keys.
5. Hands together, section by section, 60% → 80% → 100% tempo.
6. Repeat markers: "Bars 9–12 repeat bars 1–4".
Each step has a **Practice this** button that seeks to those bars, sets tempo, and enters
Practice mode.

## 6. 3D piano and practice

- **Three.js** 88-key piano (A0–C8): white and black key geometry, key press rotation
  animation, per-key emissive highlight in the pitch-class color; camera orbit limited
  to a sensible front view with a "reset view" button.
- **Falling-notes lane** above the keys (Synthesia style): notes descend and hit the key
  at their start time; right hand and left hand tinted differently; letter name drawn on
  each falling note.
- **Listen mode**: plays the selected level with audio, keys animate.
- **Practice mode**: playback pauses at each note onset until the user plays the required
  key(s). Wrong key flashes red, does not advance. Optional "left hand only / right hand
  only" (the other hand auto-plays).
- **Tempo** slider 25%–150%, **loop** a bar range, **metronome** toggle, count-in.
- **Input**: mouse/touch on 3D keys, computer keyboard (two rows mapped to two octaves,
  Z/X shift octave), and **Web MIDI** hardware keyboards when the browser supports it.
- No WebGL: fall back to a 2D canvas keyboard with the same highlight and input behavior.

## 7. Audio

- **Tone.js Sampler** with Salamander Grand Piano samples (loaded from the tonejs CDN),
  velocity sensitive, sustain pedal via Space bar.
- Fallback to a Tone.js PolySynth if samples fail to load (offline).
- AudioContext starts on first user gesture (browser requirement); show a "Tap to enable
  sound" overlay until then.
- Scheduling uses Tone.Transport so playback, falling notes, and sheet cursor share one
  clock.

## 8. Architecture and stack

| Piece | Choice | Why |
|---|---|---|
| Build | Vite 8 + TypeScript, vanilla (no framework) | Small app, most complexity is in the audio/3D loops, not in UI state. |
| MIDI parse | `@tonejs/midi` 2.x | Tempo map, tracks, note objects out of the box. |
| Notation | `abcjs` 6.x | Easiest path to a grand staff from generated text; has timing callbacks for the cursor. |
| 3D | `three` 0.185 | Standard WebGL library. |
| Audio | `tone` 15 | Sampler, transport, scheduling. |
| Tests | Vitest | Unit tests on the pipeline (key detection, chord detection, level generation) using bundled catalog songs and small synthetic MIDIs. |
| Hosting | Static (GitHub Pages / Netlify / any) | No backend needed. |

Module layout:
```
src/
  search/     bitmidi client, catalog, upload, url
  midi/       parse → normalized Song
  arrange/    key, melody, chords, levels, fingers, sections   (pure functions, tested)
  sheet/      beginner renderer (DOM), abc generator + abcjs renderer, steps generator
  piano/      three.js scene, keys, falling notes, 2D fallback
  audio/      sampler, transport, metronome
  input/      keyboard map, webmidi, pointer
  practice/   listen/practice mode state machine
  ui/         layout, controls, panels
```

## 9. Decisions (locked 2026-09-03)

| Question | Decision |
|---|---|
| Main beginner view | Both stacked: letter sheet on top, 3D piano with falling notes below. |
| LLM usage | Optional. User pastes their own Anthropic API key in Settings (stored in localStorage only). Used to (a) enrich how-to-play steps with plain-language coaching, (b) name the song when the query reads as a description and MIDI search finds little (iTunes fills that slot without a key), (c) pick what to play next from a code-built shortlist, (d) write rhythm words checked one syllable per note, and (e) read a sheet-music photo into the note DSL, which the parser validates. Rule-based generation is always the fallback and the default. Browser calls go directly to the Claude API with the direct-browser-access header. |
| Inputs in v1 | Computer keyboard, mouse/touch, and Web MIDI hardware keyboards (device picker). |
| Hosting | Static site. `vite build` output deploys to GitHub Pages or any static host. No backend. |

## 9a. MVP cut line

**MVP (first deliverable):** search + catalog + upload + URL, pipeline with L1–L4, beginner
sheet, advanced sheet, 3D piano with falling notes, Listen and Practice modes, keyboard +
mouse + Web MIDI input, sampled audio, how-to-play steps, optional Claude enrichment.

**Later:** finger hints beyond the five-finger heuristic, export to PDF/MusicXML, saving
progress, more catalog songs, YouTube link per song, tempo-change preservation.

## 10. Risks and non-goals

- Melody and chord detection are heuristics. Expected to be good on clean piano MIDIs and
  rough on dense band arrangements. The melody-track override and level 4 always exist.
- bitmidi content is user uploaded; quality and copyright status vary. The bundled catalog
  is the guaranteed path.
- No lyrics, no vocals, no audio-to-MIDI transcription from recordings.
- Not a substitute for a teacher; finger hints are suggestions.

## 11. Decisions left open for you (contribution points)

Each ships with a working default so the app is complete either way. They are small
functions (5–10 lines) where your judgement as the learner matters more than mine:

1. `arrange/levels.ts → simplifyMelodyForBeginner()` — what gets dropped at Level 1.
2. `practice/match.ts → isStepSatisfied()` — Practice mode acceptance rule: all chord
   notes required, or the melody note alone is enough, or a majority.
3. `sheet/steps.ts → tempoRamp()` — the practice tempo progression (50→80→100 or other).

## 12. Implementation status (2026-09-03)

Everything in the MVP cut line is implemented and smoke-tested headlessly against the dev
server (no console errors; search → download → arrange → play → practice verified with a
real bitmidi file). Deviations from the plan above:

- No backend at all: bitmidi is CORS-open, so search and download run in the browser.
- Level 1 adapts its quantization grid to the tune (sixteenths are kept when the melody is
  built from sixteenths, e.g. Für Elise), instead of a fixed eighth-note grid.
- Doubled notes across tracks are removed at parse time; a meter is inferred from accent
  structure when a file declares a meaningless one (1/8, 1/4).
- Sheet colours are per pitch class; 3D colours are per hand (see §5a).
- Tone.js is loaded on first user gesture so the AudioContext is created legally and the
  main bundle stays smaller.
