# Piano Sheet Generator

Type a song name, get a beginner-friendly piano arrangement at four difficulty levels, and learn it
on a 3D piano in the browser. Built for self-learners who cannot read sheet music; standard notation
is one click away for those who can.

![Letter sheet on top, 3D piano with falling notes below, step-by-step guide on the right](docs/screenshot.png)

## Features

- **Song search** on bitmidi.com (no backend needed), re-ranked locally and grouped one card per song, plus `.mid` upload, MIDI URL, and 8 bundled
  public-domain pieces (Twinkle Twinkle, Ode to Joy, Für Elise, Canon in D, …).
- **Four levels** generated from any MIDI: 1 Melody · 2 Melody + Bass · 3 Melody + Chords · 4 Original.
- **Letter sheet**: colour-coded note pills with letter names, finger numbers and chord symbols.
- **Standard notation**: grand staff rendered by abcjs.
- **3D piano** (Three.js) with Synthesia-style falling notes, key animation, and a 2D fallback.
- **Listen** and **Practice** modes. Practice waits for you to play each note before moving on.
- **How to play** steps: hand position, right hand by section, left-hand chords, hands together,
  tempo ramp. Optional rewrite by Claude with your own API key.
- **Inputs**: mouse/touch, computer keyboard (two octaves, arrow keys to shift), Web MIDI keyboards.
- **Sound**: sampled Salamander grand piano (Tone.js) with a synth fallback, metronome, sustain (Space).

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # pipeline unit tests
npm run build      # static site in dist/
```

Deploys anywhere static files are served. A GitHub Pages workflow is included in
`.github/workflows/deploy.yml` (enable Pages → Source: GitHub Actions in the repo settings).

## How the arrangement works

`src/arrange/` is pure TypeScript with tests in `test/`:

1. Parse MIDI to beats (`midi/parse.ts`), drop percussion, dedupe doubled tracks, infer a meter
   when the file's time signature is meaningless.
2. Detect the key with Krumhansl–Schmuckler profiles.
3. Pick the melody track (pitch, monophony, density, track name) and reduce it to a top voice.
4. Detect one chord per bar (or half bar) by matching a pitch-class histogram to triad/7th templates.
5. Build the levels: simplified melody, root bass, block chords, original with hand split.
6. Suggest five-finger fingering and detect repeated 4-bar sections.

If the automatic melody pick is wrong, choose another track under **Melody track** in the side panel.

## Three decisions left for you

The app ships with working defaults, but these small functions encode teaching choices worth
making yourself:

| Where | Question |
|---|---|
| `src/arrange/levels.ts` → `simplifyMelodyForBeginner()` | What gets dropped or folded to make Level 1 easy? |
| `src/practice/match.ts` → `isStepSatisfied()` | When has the learner "played" a step: exact chord, melody note only, majority? |
| `src/sheet/steps.ts` → `tempoRamp()` | How fast should the hands-together tempo ramp go? |

## Known limits

- Melody and chord detection are heuristics; dense band arrangements will be rough. Level 4 is
  always the file as written.
- Tempo changes inside a file are flattened to the first tempo.
- bitmidi hosts user uploads of varying quality and copyright status.
