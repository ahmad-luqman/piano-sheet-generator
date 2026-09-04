import type { Arrangement, Chord, Hand, Level, LevelId, LhPattern, Note, Song } from '../types';
import { LEVEL_META } from '../types';
import { buildArrangement, defaultPattern, describeChanges, explainChordRuleBased, PATTERN_META, type SectionPattern } from '../arrange';
import { parseMidi } from '../midi/parse';
import { fingerprint, fingerprintValues } from '../arrange/difficulty';
import { allCatalog, CATALOG, catalogById, isMidiEntry, loadCatalogEntry, loadCatalogSong, registerCatalog, searchCatalog, type CatalogEntry } from '../catalog/songs';
import { describeLength, loadMutopiaIndex } from '../catalog/mutopia';
import { bridgeCandidates, catalogFit, fitTone, sortForLearner } from '../catalog/readiness';
import { describeReport, KEYBOARDS, loadConstraints, saveConstraints, SPANS, type HandConstraints, type KeyboardSize } from '../arrange/constraints';
import { bridgeSong, readiness, skillProfile, type Bridge, type Readiness, type SkillProfile } from '../practice/skills';
import type { CatalogFit } from '../catalog/readiness';
import { downloadMidi, searchBitmidiAll, type SearchResult } from '../search/bitmidi';
import { searchGroups, type RankedResult, type SongGroup } from '../search/rank';
import { analyzeVersions, cachedAnalysis, type VersionAnalysis, type VersionSort } from '../search/analyze';
import { GroupCard } from './versions';
import { esc } from './dom';
import { BeginnerSheet } from '../sheet/beginner';
import { AdvancedSheet } from '../sheet/advanced';
import { generateSteps, type Step, type StepAction } from '../sheet/steps';
import { createPiano, type PianoView } from '../piano';
import { AudioEngine } from '../audio/engine';
import { InputBus } from '../input/bus';
import { ComputerKeyboard } from '../input/keyboard';
import { WebMidiInput } from '../input/webmidi';
import { Player, type Hands, type PlayMode, type StepResult } from '../practice/player';
import { Preview } from '../practice/preview';
import { scoreAttempt, type AttemptMeta, type AttemptScore } from '../practice/score';
import { TIMING } from '../practice/match';
import { barQuality } from '../practice/score';
import { dailySet, ProgressStore, recordAttempt, scaffoldLevel, songKey, type SongProgress, type StageProgress } from '../practice/progress';
import { describeGhost, ghostPlan } from '../practice/ghost';
import { handsNeeded, nextAction, type NextAction } from '../practice/next';
import { ProgressPanel } from './progress';
import { chooseAccompaniment, diagnoseErrors, enrichSteps, explainChord, explainVersions, getApiKey, readSheetPhoto, recommendSongs, rhythmWords, setApiKey, understandQuery, writeJournal, type RecommendCandidate } from '../llm/claude';
import { candidateQuery, lookupCanonical, sameAsQuery, SOURCE_LABEL, type QueryCandidate } from '../search/canonical';
import { looksLikeProse, resultsAreWeak } from '../search/intent';

const $ = <T extends HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`Missing element ${sel}`);
  return el;
};

export class App {
  private song: Song | null = null;
  private arr: Arrangement | null = null;
  private levelId: LevelId = 1;
  private transposeEarly = true;
  private easeHard = true;
  private sectionPatterns: SectionPattern[] | undefined;
  private patternNote = '';
  private sheetTab: 'beginner' | 'advanced' = 'beginner';
  private steps: Step[] = [];
  private currentStep = -1;

  private bus = new InputBus();
  private audio = new AudioEngine();
  private piano: PianoView;
  private beginner: BeginnerSheet;
  private advanced: AdvancedSheet;
  private player: Player;
  private keyboard: ComputerKeyboard;
  private midi: WebMidiInput;
  private searchAbort: AbortController | null = null;
  private preview: Preview;
  private previewButton: HTMLButtonElement | null = null;
  private versionSort: VersionSort = 'best';
  private cards: GroupCard[] = [];
  private lastFeedbackTimers = new Map<number, number>();
  private store = new ProgressStore();
  private constraints: HandConstraints = loadConstraints();
  private ghostOn = readFlag('psg.ghost');
  /** This session's run count per candidate cell, per song and stage, for the ghost hand's hand-back cadence. */
  private ghostRuns: Record<string, Record<string, number>> = {};
  private progressPanel: ProgressPanel;
  private attempt: { meta: AttemptMeta; results: StepResult[]; startedMs: number } | null = null;
  private lastScore: AttemptScore | null = null;
  private next: NextAction | null = null;
  private diagnosis: string | undefined;
  private panelBusy: 'diagnose' | 'journal' | undefined;
  private aidsAppliedFor = '';

  constructor(_root: HTMLElement) {
    if (import.meta.env.DEV) (window as any).__app = this;
    this.piano = createPiano($('#piano'));
    this.beginner = new BeginnerSheet($('#sheet-beginner'));
    this.advanced = new AdvancedSheet($('#sheet-advanced'));
    this.player = new Player(this.audio, this.bus, {
      onPosition: (b) => this.onPosition(b),
      onWaiting: (req) => this.onWaiting(req),
      onFeedback: (midi, ok) => this.onFeedback(midi, ok),
      onStateChange: (playing) => { $('#btn-play').textContent = playing ? '❚❚ Pause' : '▶ Play'; if (playing) this.beginAttempt(); else this.finishAttempt(); },
      onEnd: () => this.toast('End of piece. Nice work!'),
      onStepResult: (r) => this.onStepResult(r),
      onLoopRestart: () => { this.finishAttempt(); this.beginAttempt(); },
    });
    this.progressPanel = new ProgressPanel($('#progress'), {
      run: (a) => this.runAction(a),
      showAllAids: () => { this.applyAids(0); this.renderProgress(); },
      openCatalog: (id: string) => this.openCatalog(id),
      diagnose: () => this.diagnose(),
      journal: () => this.journal(),
    });
    this.keyboard = new ComputerKeyboard(this.bus, (t) => t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement);
    this.midi = new WebMidiInput(this.bus);
    this.preview = new Preview(this.audio);
    this.preview.onStop = () => { if (this.previewButton) this.previewButton.textContent = '▶ Preview'; this.previewButton = null; };

    this.wireBus();
    this.wireUi();
    this.refreshKeyLabels();
    this.audio.onState = (s) => { $('#audio-status').textContent = s === 'loading' ? 'Loading piano samples…' : s === 'sampler' ? 'Sampled grand piano ready' : s === 'synth' ? 'Synth piano (samples unavailable)' : ''; };

    if (this.piano.kind === '2d') this.toast('WebGL is unavailable, showing a 2D keyboard.');
    this.loadSong(loadCatalogSong(CATALOG[0]));
    $('#overlay-audio').hidden = false;
    // The bundled Mutopia index is a few hundred pieces; searches that run before it lands just see the eight built-ins.
    void loadMutopiaIndex().then((entries) => registerCatalog(entries)).catch((err) => this.toast(`Mutopia catalog unreadable: ${msg(err)}`, true));
  }

  // ───────────────────────── wiring ─────────────────────────

  private wireBus(): void {
    this.bus.on((ev, on) => {
      if (ev.source === 'playback') {
        const hand = this.handAt(ev.midi, this.player.beat);
        this.piano.setKeyState(ev.midi, on ? 'playback' : 'off', hand);
        return;
      }
      // Human input: sound + green key.
      if (on) this.audio.noteOn(ev.midi, ev.velocity); else this.audio.noteOff(ev.midi);
      if (on) this.piano.setKeyState(ev.midi, 'user');
      else this.piano.setKeyState(ev.midi, this.bus.playbackHeld.has(ev.midi) ? 'playback' : 'off', this.handAt(ev.midi, this.player.beat));
    });
    this.piano.onKeyPress = (m) => { void this.ensureAudio(); this.bus.noteOn(m, 0.8, 'pointer'); };
    this.piano.onKeyRelease = (m) => this.bus.noteOff(m, 'pointer');
    this.keyboard.onOctaveChange = () => this.refreshKeyLabels();
    this.keyboard.onSustain = (down) => this.audio.setSustain(down);
  }

  private wireUi(): void {
    $('#btn-enable-audio').addEventListener('click', async () => { $('#overlay-audio').hidden = true; await this.ensureAudio(); });
    $('#overlay-audio').addEventListener('click', (e) => { if (e.target === e.currentTarget) { $('#overlay-audio').hidden = true; void this.ensureAudio(); } });

    $<HTMLFormElement>('#search-form').addEventListener('submit', (e) => { e.preventDefault(); void this.search($<HTMLInputElement>('#search-input').value); });
    $<HTMLInputElement>('#opt-easykey').addEventListener('change', (e) => { this.transposeEarly = (e.target as HTMLInputElement).checked; this.arrange(this.arr?.melodyTrack); });
    $('#btn-catalog').addEventListener('click', () => this.showLibrary());
    $<HTMLInputElement>('#file-input').addEventListener('change', async (e) => {
      const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return;
      try { this.loadSong(parseMidi(await f.arrayBuffer(), f.name.replace(/\.midi?$/i, ''), 'upload')); } catch (err) { this.toast(`Could not read that file: ${msg(err)}`, true); }
      (e.target as HTMLInputElement).value = '';
    });
    $('#btn-url').addEventListener('click', () => $<HTMLDialogElement>('#dlg-url').showModal());
    $<HTMLDialogElement>('#dlg-url').addEventListener('close', () => {
      const dlg = $<HTMLDialogElement>('#dlg-url');
      if (dlg.returnValue !== 'ok') return;
      const url = $<HTMLInputElement>('#url-input').value.trim();
      if (url) void this.loadFromUrl(url, url.split('/').pop() ?? 'MIDI');
    });
    document.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('#results, #search-form')) this.hideResults(); });

    const picker = $('#level-picker');
    for (const id of [1, 2, 3, 4, 5, 6] as LevelId[]) {
      const b = document.createElement('button');
      b.innerHTML = `<b>${id}</b><span>${LEVEL_META[id].name}</span>`;
      b.title = LEVEL_META[id].description;
      b.addEventListener('click', () => this.setLevel(id));
      b.dataset.level = String(id);
      picker.appendChild(b);
    }
    document.querySelectorAll<HTMLButtonElement>('.sheet-tabs .tab').forEach((t) => t.addEventListener('click', () => this.setSheetTab(t.dataset.sheet as 'beginner' | 'advanced')));

    $('#btn-play').addEventListener('click', () => this.togglePlay());
    $('#btn-stop').addEventListener('click', () => this.player.stop());
    document.querySelectorAll<HTMLButtonElement>('#mode-seg .seg-btn').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode as PlayMode)));
    document.querySelectorAll<HTMLButtonElement>('#hands-seg .seg-btn').forEach((b) => b.addEventListener('click', () => this.setHands(b.dataset.hands as Hands)));
    const tempo = $<HTMLInputElement>('#tempo');
    tempo.addEventListener('input', () => this.setTempo(parseInt(tempo.value, 10) / 100));
    $('#btn-loop').addEventListener('click', () => this.toggleLoop());
    $('#btn-metro').addEventListener('click', () => { this.player.metronome = !this.player.metronome; $('#btn-metro').classList.toggle('active', this.player.metronome); });
    $('#btn-reset-view').addEventListener('click', () => this.piano.resetView());

    const devices = $<HTMLSelectElement>('#midi-devices');
    devices.addEventListener('focus', () => void this.connectMidi());
    devices.addEventListener('change', () => this.midi.select(devices.value || null));
    if (!this.midi.supported) { devices.disabled = true; devices.title = 'Web MIDI is not supported in this browser'; }
    this.midi.onDevicesChanged = () => this.fillDevices();

    $('#btn-settings').addEventListener('click', () => {
      $<HTMLInputElement>('#api-key').value = getApiKey() ?? '';
      $<HTMLDialogElement>('#dlg-settings').showModal();
    });
    $<HTMLInputElement>('#api-key').addEventListener('change', (e) => setApiKey((e.target as HTMLInputElement).value.trim() || null));
    const keys = $<HTMLSelectElement>('#opt-keys'), span = $<HTMLSelectElement>('#opt-span');
    for (const [k, v] of Object.entries(KEYBOARDS)) keys.add(new Option(v.name, k));
    for (const s of SPANS) span.add(new Option(s.name, String(s.value)));
    keys.value = String(this.constraints.keys); span.value = String(this.constraints.span);
    const onHands = () => {
      this.constraints = { keys: parseInt(keys.value, 10) as KeyboardSize, span: parseInt(span.value, 10) };
      saveConstraints(this.constraints);
      this.arrange(this.arr?.melodyTrack);
    };
    keys.addEventListener('change', onHands); span.addEventListener('change', onHands);
    $<HTMLInputElement>('#opt-fingers').addEventListener('change', (e) => this.beginner.setOptions({ showFingers: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('#opt-letters').addEventListener('change', (e) => this.beginner.setOptions({ showLetters: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('#opt-falling').addEventListener('change', (e) => this.piano.setNotes((e.target as HTMLInputElement).checked ? (this.level?.notes ?? []) : []));
    $<HTMLInputElement>('#opt-octaves').addEventListener('change', (e) => this.beginner.setOptions({ showOctaves: (e.target as HTMLInputElement).checked }));
    $<HTMLSelectElement>('#lh-pattern').addEventListener('change', (e) => void this.choosePattern((e.target as HTMLSelectElement).value));
    document.addEventListener('click', (e) => { const pop = $('#chord-pop'); if (!pop.hidden && !(e.target as HTMLElement).closest('#chord-pop, .bs-chord')) pop.hidden = true; });
    $<HTMLInputElement>('#opt-new').addEventListener('change', (e) => this.beginner.setOptions({ highlightNew: (e.target as HTMLInputElement).checked }));
    $<HTMLInputElement>('#opt-ease').addEventListener('change', (e) => { this.easeHard = (e.target as HTMLInputElement).checked; this.arrange(this.arr?.melodyTrack); });
    $<HTMLInputElement>('#opt-labels').addEventListener('change', (e) => this.piano.setShowLabels((e.target as HTMLInputElement).checked));
    $<HTMLInputElement>('#opt-countin').addEventListener('change', (e) => { this.player.countInBeats = (e.target as HTMLInputElement).checked ? (this.arr?.beatsPerBar ?? 4) : 0; });
    $<HTMLInputElement>('#opt-ghost').checked = this.ghostOn;
    $<HTMLInputElement>('#opt-ghost').addEventListener('change', (e) => { this.ghostOn = (e.target as HTMLInputElement).checked; writeFlag('psg.ghost', this.ghostOn); });
    $<HTMLInputElement>('#volume').addEventListener('input', (e) => this.audio.setVolumeDb(parseInt((e.target as HTMLInputElement).value, 10)));
    $('#btn-enrich').addEventListener('click', () => void this.coach());
    $('#btn-words').addEventListener('click', () => void this.words());
    $<HTMLInputElement>('#photo-input').addEventListener('change', (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) void this.photo(f); (e.target as HTMLInputElement).value = ''; });

    $<HTMLSelectElement>('#melody-track').addEventListener('change', (e) => {
      if (!this.song) return;
      this.arrange(parseInt((e.target as HTMLSelectElement).value, 10));
    });

    window.addEventListener('keydown', (e) => {
      const t = e.target as HTMLElement;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (e.code === 'Enter') { e.preventDefault(); this.togglePlay(); }
      if (e.code === 'Escape') { this.player.stop(); }
    });
  }

  // ───────────────────────── song loading ─────────────────────────

  /**
   * Catalog first, then bitmidi. When the results are weak, a "did you mean" lookup runs:
   * Claude when a key is set and the query reads as a description, otherwise iTunes then
   * MusicBrainz. No result at all and a confident candidate means one automatic hop to
   * searching that candidate instead; the other candidates become chips. A redirected
   * search never redirects again.
   */
  private async search(query: string, opts: { redirect?: { from: string; via: QueryCandidate; alternatives: QueryCandidate[] }; noAssist?: boolean } = {}): Promise<void> {
    const q = query.trim();
    if (!q) return;
    this.searchAbort?.abort();
    const ac = new AbortController(); this.searchAbort = ac;
    const { redirect } = opts;
    const note = redirect ? `${SOURCE_LABEL[redirect.via.source]} read “${redirect.from}” as this` : undefined;
    const local = searchCatalog(q).slice(0, MAX_CATALOG_HITS).map(({ entry, score }) => catalogResult(entry, score));
    this.showResults(searchGroups(local, q), q, false, [note, 'Searching bitmidi.com…'].filter(Boolean).join(' · '));
    // Ask Claude while bitmidi is searching; both answers are wanted for a description.
    const askClaude = !redirect && !opts.noAssist && !!getApiKey() && looksLikeProse(q);
    const understood = askClaude ? understandQuery(q) : null;
    understood?.catch(() => { /* reported below */ });

    let groups: SongGroup[];
    try {
      const remote = await searchBitmidiAll(q, ac.signal);
      if (ac.signal.aborted) return;
      groups = searchGroups([...local, ...remote], q);
      this.showResults(groups, q, true, note);
    } catch (err) {
      if (ac.signal.aborted) return;
      groups = searchGroups(local, q);
      this.showResults(groups, q, true, [note, `Internet search failed (${msg(err)}). Built-in matches shown.`].filter(Boolean).join(' · '));
    }
    if (redirect) {
      this.showSuggestions(redirect.alternatives, 'Or did you mean:', { label: `“${redirect.from}” as typed`, run: () => void this.search(redirect.from, { noAssist: true }) });
      return;
    }
    if (opts.noAssist || !resultsAreWeak(groups)) return;

    // Claude first when it was asked, then iTunes and MusicBrainz; only the whole chain failing is reported.
    let candidates: QueryCandidate[] = [];
    let failure: unknown;
    if (understood) {
      try { candidates = await understood; } catch (err) { failure = err; }
    }
    if (candidates.length === 0) {
      try { candidates = await lookupCanonical(q, ac.signal); failure = undefined; }
      catch (err) { failure = failure ?? err; }
    }
    if (ac.signal.aborted) return;
    if (failure) { this.showAssistNote(`Could not look up the title (${msg(failure)}).`); return; }
    candidates = candidates.filter((c) => !sameAsQuery(c, q));
    if (candidates.length === 0) return;
    if (groups.length === 0) {
      const [via, ...alternatives] = candidates;
      await this.search(candidateQuery(via), { redirect: { from: q, via, alternatives } });
      return;
    }
    this.showSuggestions(candidates, `${SOURCE_LABEL[candidates[0].source]} suggests:`);
  }

  /** One card per song; uploads of the same title sit behind a "N versions" toggle. */
  private showResults(groups: SongGroup[], q: string, done: boolean, note?: string, actions: HTMLElement[] = []): void {
    const box = $('#results');
    box.innerHTML = '';
    const files = groups.reduce((n, g) => n + g.versions.length, 0);
    const head = document.createElement('div'); head.className = 'res-head';
    const count = groups.length === files ? `${groups.length} result${groups.length === 1 ? '' : 's'}` : `${groups.length} song${groups.length === 1 ? '' : 's'}, ${files} files`;
    head.innerHTML = `<span>${count}${q ? ` for “${esc(q)}”` : ''}${note ? ` · ${esc(note)}` : ''}</span><span class="res-actions"></span>`;
    const close = document.createElement('button'); close.className = 'btn small'; close.textContent = 'Close';
    close.addEventListener('click', () => { box.hidden = true; });
    head.querySelector('.res-actions')!.append(...actions, close);
    box.appendChild(head);
    if (groups.length === 0 && done) { const e = document.createElement('div'); e.className = 'res-empty'; e.textContent = 'Nothing found. Try the original title, the composer, or fewer words.'; box.appendChild(e); }
    this.cards = groups.map((g) => new GroupCard(g, this.groupHandlers));
    for (const c of this.cards) box.appendChild(c.el);
    box.hidden = false;
  }

  private hideResults(): void {
    $('#results').hidden = true;
    this.preview.stop();
  }

  private readonly groupHandlers = {
    pick: (r: RankedResult) => { this.hideResults(); void this.pick(r); },
    analyze: (versions: RankedResult[], card: GroupCard) => {
      const signal = this.searchAbort?.signal;
      void analyzeVersions(versions, { limit: versions.length, concurrency: 3, signal, onEach: () => card.refresh() }).then(() => card.refresh());
    },
    preview: (a: VersionAnalysis, button: HTMLButtonElement) => void this.previewVersion(a, button),
    explain: (g: SongGroup, analyses: VersionAnalysis[]) => this.explainVersions(g, analyses),
    sort: { get: () => this.versionSort, set: (s: VersionSort) => { this.versionSort = s; for (const c of this.cards) c.refresh(); } },
  };

  /** Eight bars of the stage 1 melody through the sampler; a second click on the same button stops it. */
  private async previewVersion(a: VersionAnalysis, button: HTMLButtonElement): Promise<void> {
    if (this.previewButton === button) { this.preview.stop(); return; }
    this.player.pause();
    await this.ensureAudio();
    this.preview.stop();
    this.previewButton = button; button.textContent = '■ Stop';
    this.preview.play(a.preview, a.bpm);
  }

  private async explainVersions(g: SongGroup, analyses: VersionAnalysis[]): Promise<Map<string, string>> {
    if (!getApiKey()) { this.toast('Add your Anthropic API key in Settings (⚙) to let Claude explain the picks.', true); $<HTMLDialogElement>('#dlg-settings').showModal(); return new Map(); }
    try { return await explainVersions(g.displayTitle, g.artist, analyses); }
    catch (err) { this.toast(`Could not ask Claude: ${msg(err)}`, true); return new Map(); }
  }

  /** "Did you mean" chips under the results; each runs a fresh search for that candidate. */
  private showSuggestions(candidates: QueryCandidate[], label: string, extra?: { label: string; run: () => void }): void {
    if (candidates.length === 0 && !extra) return;
    const box = $('#results');
    const wrap = document.createElement('div'); wrap.className = 'res-sugg';
    const head = document.createElement('span'); head.className = 'muted small'; head.textContent = label; wrap.appendChild(head);
    for (const c of candidates) {
      const t = candidateQuery(c);
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = t;
      if (c.reason) b.title = c.reason;
      b.addEventListener('click', () => { $<HTMLInputElement>('#search-input').value = t; void this.search(t); });
      wrap.appendChild(b);
    }
    if (extra) { const b = document.createElement('button'); b.className = 'btn small'; b.textContent = extra.label; b.addEventListener('click', extra.run); wrap.appendChild(b); }
    box.appendChild(wrap);
  }

  private showAssistNote(text: string): void {
    const wrap = document.createElement('div'); wrap.className = 'res-sugg';
    const head = document.createElement('span'); head.className = 'muted small'; head.textContent = text; wrap.appendChild(head);
    $('#results').appendChild(wrap);
  }

  private async pick(r: SearchResult): Promise<void> {
    if (r.source === 'catalog') {
      const entry = catalogById(r.id);
      if (!entry) { this.toast(`“${r.name}” is no longer in the catalog.`, true); return; }
      if (isMidiEntry(entry)) this.toast(`Loading “${entry.title}”…`);
      try { this.loadSong(await loadCatalogEntry(entry)); }
      catch (err) { this.toast(`Could not load: ${msg(err)}`, true); }
      return;
    }
    // A failed or invalid analysis is not final: a fresh download reports its own error, and a blip gets retried.
    const analysed = cachedAnalysis(r);
    if (analysed?.song) { this.loadSong(analysed.song); return; }
    await this.loadFromUrl(r.downloadUrl, r.name);
  }

  private async loadFromUrl(url: string, title: string): Promise<void> {
    this.toast(`Downloading “${title}”…`);
    try {
      const buf = await downloadMidi(url);
      this.loadSong(parseMidi(buf, title, url.includes('bitmidi') ? 'bitmidi' : 'url'));
    } catch (err) { this.toast(`Could not load: ${msg(err)}`, true); }
  }

  private loadSong(song: Song): void {
    this.player.pause();
    this.song = song;
    if (song.notes.length === 0) { this.toast('That file has no notes.', true); return; }
    const sel = $<HTMLSelectElement>('#melody-track');
    sel.innerHTML = '';
    for (const t of song.tracks) { const o = document.createElement('option'); o.value = String(t.index); o.textContent = `${t.name} (${t.noteCount} notes)`; sel.appendChild(o); }
    this.sectionPatterns = undefined; this.patternNote = '';
    $<HTMLSelectElement>('#lh-pattern').value = 'auto';
    this.arrange();
    if (!this.arr) return;
    const sug = this.arr.suggestedLevel;
    if (sug) this.setLevel(sug.level, true);
    this.toast(`Loaded “${song.title}”. ${song.tracks.length} track${song.tracks.length === 1 ? '' : 's'}, ${this.arr.totalBars} bars.${sug ? ` Starting at stage ${sug.level}.` : ''}`);
  }

  private arrange(melodyTrack?: number): void {
    if (!this.song) return;
    try {
      this.arr = buildArrangement(this.song, { melodyTrack, transposeEarly: this.transposeEarly, easeHardSections: this.easeHard, sectionPatterns: this.sectionPatterns, constraints: this.constraints });
    } catch (err) { this.toast(`Could not arrange: ${msg(err)}`, true); return; }
    $<HTMLSelectElement>('#melody-track').value = String(this.arr.melodyTrack);
    $('#song-title').textContent = this.arr.title;
    const hands = this.arr.constraintReport ? describeReport(this.arr.constraintReport, this.constraints) : '';
    $('#song-info').textContent = `${this.arr.key.name} · ${this.arr.bpm} bpm · ${this.arr.timeSig.num}/${this.arr.timeSig.den} · ${this.arr.totalBars} bars · ${this.song.source}${hands ? ` · ${hands}` : ''}`;
    const sug = this.arr.suggestedLevel;
    $('#level-hint').textContent = sug ? `Suggested start: stage ${sug.level}; ${sug.reason}.` : '';
    const partner = this.arr.partnerTrack !== undefined ? this.song.tracks.find((t) => t.index === this.arr!.partnerTrack) : undefined;
    document.querySelector<HTMLButtonElement>('#level-picker [data-level="6"]')!.title = partner && this.song.tracks.length > 2
      ? `${LEVEL_META[6].description} Left hand: “${partner.name}”.` : LEVEL_META[6].description;
    this.setLevel(this.levelId, true);
  }

  // ───────────────────────── level / views ─────────────────────────

  private get level(): Level | null { return this.arr ? this.arr.levels[this.levelId] : null; }

  private setLevel(id: LevelId, force = false): void {
    if (!this.arr) return;
    if (!force && id === this.levelId) return;
    const wasPlaying = this.player.isPlaying;
    const beat = this.player.beat;
    this.player.pause();
    this.levelId = id;
    document.querySelectorAll<HTMLButtonElement>('#level-picker button').forEach((b) => b.classList.toggle('active', b.dataset.level === String(id)));
    const level = this.level!;
    $('#easy-key-info').textContent = level.transpose ? `${level.key.name}, from ${this.arr.key.name}` : '';
    const eased = (level.eased ?? []).map((e) => { const s = this.arr!.sections[e.section]; return `bars ${s.startBar + 1}–${s.endBar + 1} shown as stage ${e.fromLevel}`; });
    $('#level-changes').textContent = [describeChanges(level), ...eased, id === 5 ? this.patternNote : ''].filter(Boolean).join(' ').replace(/\. bars/, '. Bars');
    $('#lh-pattern-wrap').hidden = id !== 5;
    $<HTMLOptionElement>('#lh-pattern option[value="auto"]').textContent = `Auto (${PATTERN_META[defaultPattern(this.arr.timeSig, this.arr.bpm)].name.toLowerCase()})`;
    this.beginner.render(this.arr, level);
    // The scaffold applies when the song or stage changes, not on same-stage re-renders, so manual aid choices survive toggles.
    const aidsTag = `${this.songProgressKey()}|${id}`;
    if (aidsTag !== this.aidsAppliedFor) { this.applyAids(scaffoldLevel(this.stage())); this.aidsAppliedFor = aidsTag; }
    this.beginner.onSeek = (b) => this.seek(b);
    this.beginner.onChordClick = (c, bar, x, y) => this.showChordPop(c, bar, x, y);
    this.advanced.onSeek = (b) => this.seek(b);
    if (this.sheetTab === 'advanced') this.advanced.render(this.arr, level); else this.advancedDirty = true;
    this.piano.setNotes($<HTMLInputElement>('#opt-falling').checked ? level.notes : []);
    if (level.notes.length) this.piano.setFocusRange(Math.min(...level.notes.map((n) => n.midi)), Math.max(...level.notes.map((n) => n.midi)));
    this.player.load(level, this.arr.bpm, this.arr.beatsPerBar);
    this.player.seek(Math.min(beat, this.player.duration));
    if (this.player.countInBeats) this.player.countInBeats = this.arr.beatsPerBar;
    this.diagnosis = undefined; this.lastScore = null;
    this.renderProgress();
    this.renderSteps();
    if (wasPlaying) this.player.play();
  }

  // ───────────────────────── progress ─────────────────────────

  private songProgressKey(): string | null { return this.arr && this.song ? songKey(this.arr, this.song) : null; }
  private stage(): StageProgress | undefined { const k = this.songProgressKey(); return k ? this.store.peek(k, this.levelId) : undefined; }
  private songProgress(): SongProgress | undefined { const k = this.songProgressKey(); return k ? this.store.load()[k] : undefined; }

  /** Fingerprint values of one stage of the current song at its tempo; stored with attempts and compared with the profile. */
  stageFingerprint(level: LevelId): number[] | undefined {
    return this.arr ? fingerprintValues(fingerprint(this.arr.levels[level].notes, this.arr.bpm)) : undefined;
  }

  /** The skill profile over everything saved in this browser. Cheap: a few dozen stage records at most. */
  private profile(): SkillProfile { return skillProfile(Object.values(this.store.load())); }

  /** The library, ordered for this learner: ready pieces first, then small stretches, then the rest, easiest first. */
  private showLibrary(): void {
    const profile = this.profile();
    const fits = sortForLearner(allCatalog(), profile);
    const results = fits.map((f) => catalogResult(f.entry, undefined, f));
    const ready = fits.filter((f) => f.fit.kind === 'ready').length;
    const note = profile.values ? `sorted for you: ${ready} ready now, then small stretches` : 'sorted easiest first; play something clean in Rhythm or Perform mode to sort for you';
    const actions: HTMLElement[] = [];
    if (profile.values && getApiKey()) {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = '✨ What next?';
      b.addEventListener('click', () => void this.recommend(fits, b));
      actions.push(b);
    }
    this.showResults(searchGroups(results, ''), '', true, note, actions);
  }

  /** Claude picks three from the shortlist code already judged ready or a small stretch; the list order is the fallback. */
  private async recommend(fits: CatalogFit[], button: HTMLButtonElement): Promise<void> {
    button.disabled = true; button.textContent = '✨ Thinking…';
    try {
      const shortlist: RecommendCandidate[] = fits
        .filter((f) => f.fit.kind === 'ready' || f.fit.kind === 'stretch' || (f.fit.kind === 'needs' && f.fit.gaps.length === 1))
        .slice(0, 25)
        .map((f) => ({ id: f.entry.id, title: f.entry.title, composer: f.entry.composer, bars: isMidiEntry(f.entry) ? f.entry.bars : 16, fit: `${f.fit.label}: ${f.fit.detail}`, suggested: f.suggested }));
      const recent = Object.values(this.store.load()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)
        .map((s) => { const stages = Object.entries(s.stages); const [id, st] = stages[stages.length - 1] ?? ['1', undefined]; return { title: s.title, stage: parseInt(id, 10), clean: !!st?.cleanRuns }; });
      const picks = await recommendSongs(this.profile(), recent, shortlist);
      if (picks.length === 0) { this.toast('Claude had no pick beyond the order shown.'); return; }
      const box = $('#results');
      const wrap = document.createElement('div'); wrap.className = 'res-sugg';
      const head = document.createElement('span'); head.className = 'muted small'; head.textContent = 'Claude suggests:'; wrap.appendChild(head);
      for (const p of picks) {
        const f = fits.find((x) => x.entry.id === p.id)!;
        const b = document.createElement('button'); b.className = 'btn small'; b.textContent = `${f.entry.title} — ${f.entry.composer}`; b.title = p.reason;
        b.addEventListener('click', () => this.openCatalog(p.id));
        wrap.appendChild(b);
        if (p.reason) { const r = document.createElement('span'); r.className = 'muted small'; r.textContent = p.reason; wrap.appendChild(r); }
      }
      box.insertBefore(wrap, box.children[1] ?? null);
    } catch (err) { this.toast(`Could not ask Claude: ${msg(err)}`, true); }
    finally { button.disabled = false; button.textContent = '✨ What next?'; }
  }

  /** Words to say while playing each right-hand section; code checks one syllable per note before showing them. */
  private async words(): Promise<void> {
    if (!this.arr || !this.level) return;
    if (!getApiKey()) { this.toast('Add your Anthropic API key in Settings (⚙) to get rhythm words.', true); $<HTMLDialogElement>('#dlg-settings').showModal(); return; }
    const btn = $<HTMLButtonElement>('#btn-words');
    btn.disabled = true; btn.textContent = '✨ Thinking…';
    try {
      const bpb = this.arr.beatsPerBar;
      const requests = this.arr.sections.filter((s) => s.repeatOf === undefined).map((s) => {
        const rh = this.level!.notes.filter((n) => n.hand === 'rh' && n.startBeat >= s.startBar * bpb && n.startBeat < (s.endBar + 1) * bpb);
        const onsets: { letter: string; dur: number }[] = [];
        let lastStart = -1;
        for (const n of rh) { if (Math.abs(n.startBeat - lastStart) < 0.01) continue; lastStart = n.startBeat; onsets.push({ letter: n.letter, dur: n.durationBeats }); }
        return { section: s.index, label: s.label, bars: `${s.startBar + 1}-${s.endBar + 1}`, noteCount: onsets.length, letters: onsets.map((o) => o.letter).join(' '), rhythm: onsets.map((o) => o.dur).join(' ') };
      }).filter((r) => r.noteCount >= 2 && r.noteCount <= 40);
      const got = await rhythmWords(this.arr, requests);
      if (got.length === 0) { this.toast('Claude’s words did not fit the notes, so none were kept.', true); return; }
      for (const m of got) {
        const sec = this.arr.sections[m.section];
        for (const st of this.steps) if (st.action?.hands === 'rh' && st.action.startBar === sec.startBar && st.action.endBar === sec.endBar) st.body += ` Say it as you play: “${m.words}”.`;
      }
      this.paintSteps();
      this.toast(`Words added for ${got.length} of ${requests.length} sections.`);
    } catch (err) { this.toast(`Could not ask Claude: ${msg(err)}`, true); }
    finally { btn.disabled = false; btn.textContent = '✨ Words'; }
  }

  /** A photo of sheet music: Claude writes the note DSL, parseDsl validates it, and the result loads like any song. */
  private async photo(file: File): Promise<void> {
    if (!getApiKey()) { this.toast('Add your Anthropic API key in Settings (⚙) to read sheet music from a photo.', true); $<HTMLDialogElement>('#dlg-settings').showModal(); return; }
    const type = file.type as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
    if (!['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)) { this.toast('Use a JPEG, PNG, GIF or WebP photo.', true); return; }
    if (file.size > 5 * 1024 * 1024) { this.toast('That photo is over 5 MB; a phone-sized JPEG works best.', true); return; }
    this.toast('Reading the sheet music… this takes a few seconds.');
    try {
      const data = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1] ?? ''); r.onerror = () => reject(r.error); r.readAsDataURL(file); });
      const { song, notes } = await readSheetPhoto({ data, mediaType: type });
      this.loadSong(song);
      if (notes) this.toast(`Read from the photo. Claude notes: ${notes}`);
    } catch (err) { this.toast(`Could not read the photo: ${msg(err)}`, true); }
  }

  /** Readiness of the current stage and a bridge song, for the progress panel. */
  private fitState(): { fit?: Readiness; bridge?: Bridge; credited: number } {
    if (!this.arr || !this.level) return { credited: 0 };
    const profile = this.profile();
    const fit = readiness(this.stageFingerprint(this.levelId)!, profile);
    const current = this.song?.source === 'catalog' ? allCatalog().find((e) => this.arr!.title.startsWith(e.title))?.id : undefined;
    const bridge = fit.kind === 'needs' || fit.kind === 'stretch' ? bridgeSong(fit, profile, bridgeCandidates(allCatalog()), current) : undefined;
    return { fit, bridge, credited: profile.credited };
  }

  private openCatalog(id: string): void {
    const entry = catalogById(id);
    if (!entry) { this.toast('That piece is no longer in the catalog.', true); return; }
    this.hideResults();
    void loadCatalogEntry(entry).then((song) => this.loadSong(song)).catch((err) => this.toast(`Could not load: ${msg(err)}`, true));
  }

  private beginAttempt(): void {
    if (!this.arr || this.player.mode === 'listen') return;
    const bpb = this.arr.beatsPerBar;
    const loop = this.player.loop;
    const startBar = Math.max(0, Math.floor(Math.max(0, this.player.beat) / bpb));
    this.attempt = {
      meta: { level: this.levelId, mode: this.player.mode, hands: this.player.hands, tempoScale: this.player.tempoScale,
        startBar: loop ? Math.max(startBar, Math.round(loop.start / bpb)) : startBar, endBar: loop ? Math.round(loop.end / bpb) - 1 : this.arr.totalBars - 1,
        startedAt: new Date().toISOString(), durationSec: 0 },
      results: [], startedMs: performance.now(),
    };
    $('#status').textContent = '';
    this.applyGhost();
  }

  /** Learn mode with the ghost hand on: play the weak cells for the learner, handing each back every third run. */
  private applyGhost(): void {
    if (!this.ghostOn || this.player.mode !== 'learn' || !this.arr) { this.player.setGhost(new Set()); return; }
    const key = `${this.songProgressKey()}|${this.levelId}`;
    const runs = this.ghostRuns[key] ?? (this.ghostRuns[key] = {});
    const plan = ghostPlan(this.stage(), runs);
    for (const cell of [...plan.ghost, ...plan.handedBack]) runs[cell] = (runs[cell] ?? 0) + 1;
    this.player.setGhost(plan.ghost);
    const text = describeGhost(plan);
    if (text) $('#status').textContent = text;
    if (plan.handedBack.size) this.toast(text);
  }

  private onStepResult(r: StepResult): void {
    const a = this.attempt; if (!a) return;
    a.results.push(r);
    if (a.meta.mode !== 'rhythm') return;
    const notes = a.results.reduce((n, x) => n + x.notes.length, 0);
    const hits = a.results.reduce((n, x) => n + x.notes.filter((y) => y.hit).length, 0);
    const onTime = a.results.reduce((n, x) => n + x.notes.filter((y) => y.hit && Math.abs(y.offsetSec ?? 1) <= TIMING.goodSec).length, 0);
    $('#status').textContent = `${hits}/${notes} notes · ${onTime} on time`;
  }

  /** Score what was played, fold it into saved progress, and refresh the panel, the steps and the bar heat. */
  private finishAttempt(): void {
    this.player.setGhost(new Set());
    const a = this.attempt; this.attempt = null;
    if (!a || !this.arr || !this.level || a.results.length < 2) return;
    const bpb = this.arr.beatsPerBar;
    const level = this.arr.levels[a.meta.level];
    // A run stopped early is scored on the bars it reached, never as a whole-piece run.
    const inRange = level.notes.filter((n) => (a.meta.hands === 'both' || n.hand === a.meta.hands) && n.startBeat >= a.meta.startBar * bpb && n.startBeat < (a.meta.endBar + 1) * bpb);
    const lastBeat = Math.max(...a.results.map((r) => r.beat));
    const lastNeeded = inRange.length ? Math.max(...inRange.map((n) => n.startBeat)) : 0;
    if (lastBeat < lastNeeded - 1e-6) a.meta.endBar = Math.floor(lastBeat / bpb);
    a.meta.durationSec = Math.round((performance.now() - a.startedMs) / 100) / 10;
    const score = scoreAttempt(a.meta, a.results, level, bpb, this.arr.totalBars);
    const key = this.songProgressKey()!;
    const song = this.store.song(key, this.arr.title);
    const stage = this.store.stage(song, a.meta.level);
    const before = scaffoldLevel(stage);
    // The stage's fingerprint travels with the record so the skill profile can credit a clean run.
    const outcome = recordAttempt(stage, score, this.arr.sections, handsNeeded(this.arr, a.meta.level), new Date(), this.stageFingerprint(a.meta.level));
    this.store.touch(song);
    this.lastScore = score; this.diagnosis = undefined;
    const bits = [`notes ${Math.round(score.noteAccuracy * 100)}%`, score.timingAccuracy !== undefined ? `timing ${Math.round(score.timingAccuracy * 100)}%` : '', score.wrong ? `${score.wrong} wrong` : ''].filter(Boolean).join(', ');
    if (outcome.justEarned) this.toast(`Stage ${a.meta.level} earned! Stage ${Math.min(6, a.meta.level + 1)} is open. (${bits})`);
    else if (outcome.scaffoldAfter > before) this.toast(`${score.clean ? 'Clean run' : 'Scored'}: ${bits}. Reading aids fade: ${outcome.scaffoldAfter} hidden now.`);
    else this.toast(`${score.clean ? 'Clean run' : 'Scored'}: ${bits}.`);
    if (a.meta.level === this.levelId) {
      if (outcome.scaffoldAfter !== before) this.applyAids(outcome.scaffoldAfter);
      this.renderProgress();
      this.renderSteps();
    }
  }

  private renderProgress(): void {
    if (!this.arr) return;
    const stage = this.stage();
    // Keep Claude's pick while its diagnosis is showing; attempts and stage changes clear both.
    if (!this.diagnosis || !this.next) this.next = nextAction(this.arr, this.levelId, stage);
    this.progressPanel.render({
      arr: this.arr, levelId: this.levelId, stage, song: this.songProgress(), last: this.lastScore ?? undefined, next: this.next,
      today: dailySet(stage, this.arr.sections), scaffold: scaffoldLevel(stage), diagnosis: this.diagnosis, busy: this.panelBusy, ...this.fitState(),
    });
    const heat = new Map<number, number>();
    for (const [k, b] of Object.entries(stage?.bars ?? {})) { const bar = parseInt(k, 10); heat.set(bar, Math.min(heat.get(bar) ?? 1, barQuality(b))); }
    this.beginner.setBarScores(heat);
  }

  /** Scaffold fade-out: 0 = every aid, 1 = no finger numbers, 2 = no letters, 3 = no falling notes. */
  private applyAids(scaffold: number): void {
    const fingers = $<HTMLInputElement>('#opt-fingers'), letters = $<HTMLInputElement>('#opt-letters'), falling = $<HTMLInputElement>('#opt-falling');
    fingers.checked = scaffold < 1; letters.checked = scaffold < 2; falling.checked = scaffold < 3;
    this.beginner.setOptions({ showFingers: fingers.checked, showLetters: letters.checked });
    this.piano.setNotes(falling.checked ? (this.level?.notes ?? []) : []);
  }

  private runAction(a: StepAction): void {
    if (!this.arr) return;
    this.player.pause();
    if (a.level !== this.levelId) this.setLevel(a.level);
    this.setMode(a.mode);
    this.setHands(a.hands);
    this.setTempo(a.tempoScale);
    if (a.startBar === 0 && a.endBar >= this.arr.totalBars - 1) { this.player.clearLoop(); this.beginner.highlightBars(0, 0, false); $('#btn-loop').classList.remove('active'); }
    else { this.player.setLoop(a.startBar, a.endBar); this.beginner.highlightBars(a.startBar, a.endBar, true); $('#btn-loop').classList.add('active'); }
    this.player.seek(a.startBar * this.arr.beatsPerBar);
    void this.ensureAudio().then(() => this.player.play());
  }

  private async diagnose(): Promise<void> {
    if (!this.arr || !this.next) return;
    const stage = this.stage(); if (!stage) return;
    if (!getApiKey()) { this.toast('Add your Anthropic API key in Settings (⚙) to ask Claude.', true); $<HTMLDialogElement>('#dlg-settings').showModal(); return; }
    this.panelBusy = 'diagnose'; this.renderProgress();
    try {
      const { candidate, cause } = await diagnoseErrors(this.arr, this.levelId, stage, this.next);
      this.panelBusy = undefined;
      this.renderProgress();
      this.next = { ...candidate, candidates: this.next.candidates };
      this.diagnosis = cause;
      this.progressPanel.render({ arr: this.arr, levelId: this.levelId, stage, song: this.songProgress(), last: this.lastScore ?? undefined, next: this.next, today: dailySet(stage, this.arr.sections), scaffold: scaffoldLevel(stage), diagnosis: cause, ...this.fitState() });
      this.steps = generateSteps(this.arr, this.levelId, { title: this.next.title, reason: cause, action: this.next.action });
      this.paintSteps();
    } catch (err) { this.panelBusy = undefined; this.renderProgress(); this.toast(`Could not ask Claude: ${msg(err)}`, true); }
  }

  private async journal(): Promise<void> {
    if (!this.arr || !this.next) return;
    const song = this.songProgress(); const stage = this.stage(); if (!song || !stage) return;
    if (!getApiKey()) { this.toast('Add your Anthropic API key in Settings (⚙) to ask Claude.', true); $<HTMLDialogElement>('#dlg-settings').showModal(); return; }
    this.panelBusy = 'journal'; this.renderProgress();
    try {
      const today = new Date().toDateString();
      const attempts = stage.attempts.filter((a) => new Date(a.at).toDateString() === today);
      const text = await writeJournal(this.arr, this.levelId, attempts.length ? attempts : stage.attempts.slice(-5), this.next);
      if (!text) { this.toast('Claude returned nothing to note.', true); return; }
      song.journal.push({ at: new Date().toISOString(), text });
      if (song.journal.length > 10) song.journal.splice(0, song.journal.length - 10);
      this.store.touch(song);
    } catch (err) { this.toast(`Could not ask Claude: ${msg(err)}`, true); }
    finally { this.panelBusy = undefined; this.renderProgress(); }
  }

  private advancedDirty = true;
  private setSheetTab(tab: 'beginner' | 'advanced'): void {
    this.sheetTab = tab;
    document.querySelectorAll<HTMLButtonElement>('.sheet-tabs .tab').forEach((t) => t.classList.toggle('active', t.dataset.sheet === tab));
    $('#sheet-beginner').hidden = tab !== 'beginner';
    $('#sheet-advanced').hidden = tab !== 'advanced';
    if (tab === 'advanced' && this.arr && this.level && this.advancedDirty) { this.advanced.render(this.arr, this.level); this.advancedDirty = false; }
    this.onPosition(this.player.beat);
  }

  private renderSteps(): void {
    if (!this.arr) return;
    const stage = this.stage();
    const next = stage?.attempts.length && this.next ? { title: this.next.title, reason: this.diagnosis ?? this.next.reason, action: this.next.action } : undefined;
    this.steps = generateSteps(this.arr, this.levelId, next);
    this.paintSteps();
  }

  private paintSteps(): void {
    const ol = $('#steps');
    ol.innerHTML = '';
    this.steps.forEach((s, i) => {
      const li = document.createElement('li');
      li.innerHTML = `<h3>${esc(s.title)}</h3><p>${esc(s.body)}</p>`;
      if (s.action) {
        const b = document.createElement('button'); b.className = 'btn small primary';
        b.textContent = s.action.mode === 'listen' ? '▶ Listen' : '▶ Practise this';
        b.addEventListener('click', () => this.runStep(i));
        li.appendChild(b);
      }
      li.classList.toggle('current', i === this.currentStep);
      ol.appendChild(li);
    });
  }

  private runStep(i: number): void {
    const s = this.steps[i];
    if (!s.action || !this.arr) return;
    this.currentStep = i;
    document.querySelectorAll('#steps li').forEach((li, j) => li.classList.toggle('current', j === i));
    this.runAction(s.action);
  }

  /** Stage 5 left-hand texture: automatic, one pattern for the whole piece, or Claude's pick per section. */
  private async choosePattern(value: string): Promise<void> {
    if (!this.arr) return;
    this.patternNote = '';
    if (value === 'auto') this.sectionPatterns = undefined;
    else if (value === 'llm') {
      if (!getApiKey()) { this.toast('Add your Anthropic API key in Settings (⚙) to let Claude pick patterns.', true); $<HTMLSelectElement>('#lh-pattern').value = 'auto'; $<HTMLDialogElement>('#dlg-settings').showModal(); return; }
      this.toast('Asking Claude which left-hand pattern suits each section…');
      try {
        const picks = await chooseAccompaniment(this.arr, defaultPattern(this.arr.timeSig, this.arr.bpm));
        this.sectionPatterns = picks;
        this.patternNote = 'Claude chose: ' + picks.filter((p) => this.arr!.sections[p.section].repeatOf === undefined)
          .map((p) => `${this.arr!.sections[p.section].label} ${PATTERN_META[p.pattern].name.toLowerCase()} (${p.reason})`).join('; ') + '.';
      } catch (err) { this.toast(`Could not ask Claude: ${msg(err)}`, true); $<HTMLSelectElement>('#lh-pattern').value = 'auto'; this.sectionPatterns = undefined; }
    } else {
      const pattern = value as LhPattern;
      this.sectionPatterns = [{ start: 0, end: this.arr.totalBars * this.arr.beatsPerBar, pattern }];
    }
    this.arrange(this.arr.melodyTrack);
  }

  /** "Why this chord here?" popover: rule-based facts at once, Claude's prose on request. */
  private showChordPop(chord: Chord, bar: number, x: number, y: number): void {
    if (!this.arr || !this.level) return;
    const pop = $('#chord-pop');
    const facts = explainChordRuleBased(this.level, chord, bar, this.arr.beatsPerBar);
    pop.innerHTML = `<b>${esc(chord.name)} · bar ${bar + 1}</b><p>${esc(facts)}</p>`;
    if (getApiKey()) {
      const b = document.createElement('button'); b.className = 'btn small'; b.textContent = '✨ Explain in plain words';
      b.addEventListener('click', async () => {
        b.disabled = true; b.textContent = '✨ Thinking…';
        try { pop.querySelector('p')!.textContent = await explainChord(this.arr!, this.level!, chord, bar); b.remove(); }
        catch (err) { this.toast(`Could not ask Claude: ${msg(err)}`, true); b.disabled = false; b.textContent = '✨ Explain in plain words'; }
      });
      pop.appendChild(b);
    }
    pop.hidden = false;
    const w = 340, h = pop.offsetHeight || 120;
    pop.style.left = `${Math.min(x + 8, window.innerWidth - w - 8)}px`;
    pop.style.top = `${Math.min(y + 8, window.innerHeight - h - 8)}px`;
  }

  private async coach(): Promise<void> {
    if (!this.arr) return;
    if (!getApiKey()) { this.toast('Add your Anthropic API key in Settings (⚙) to use coaching.', true); $<HTMLDialogElement>('#dlg-settings').showModal(); return; }
    const btn = $<HTMLButtonElement>('#btn-enrich');
    btn.disabled = true; btn.textContent = '✨ Thinking…';
    try {
      this.steps = await enrichSteps(this.arr, this.levelId, this.steps, (partial, n, total) => {
        this.steps = partial; this.paintSteps(); btn.textContent = `✨ ${n} of ${total}…`;
      });
      this.paintSteps();
      this.toast('Steps rewritten by Claude.');
    } catch (err) { this.toast(`Coaching failed: ${msg(err)}`, true); }
    finally { btn.disabled = false; btn.textContent = '✨ Coach me'; }
  }

  // ───────────────────────── transport ─────────────────────────

  private async ensureAudio(): Promise<void> {
    if (!this.audio.ready) await this.audio.start();
  }

  private togglePlay(): void {
    if (this.player.isPlaying) { this.player.pause(); return; }
    void this.ensureAudio().then(() => this.player.play());
  }

  private seek(beat: number): void {
    this.player.seek(beat);
  }

  /** Changing mode or hands mid-run ends the attempt being scored and starts a fresh one under the new settings. */
  private restartAttemptIfLive(change: () => void): void {
    const live = this.attempt !== null && this.player.isPlaying;
    change();
    if (live) { this.finishAttempt(); this.beginAttempt(); }
  }

  private setMode(m: PlayMode): void {
    this.restartAttemptIfLive(() => this.player.setMode(m));
    document.querySelectorAll<HTMLButtonElement>('#mode-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    if (m === 'listen' || m === 'perform') { this.piano.setHints(null); this.beginner.setRequired(null); $('#status').textContent = ''; }
  }

  private setHands(h: Hands): void {
    this.restartAttemptIfLive(() => this.player.setHands(h));
    document.querySelectorAll<HTMLButtonElement>('#hands-seg .seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.hands === h));
  }

  private setTempo(scale: number): void {
    this.player.tempoScale = scale;
    // A run is scored at the slowest tempo it was played at, so slowing down mid-run cannot earn a fast clean run.
    if (this.attempt) this.attempt.meta.tempoScale = Math.min(this.attempt.meta.tempoScale, scale);
    $<HTMLInputElement>('#tempo').value = String(Math.round(scale * 100));
    $('#tempo-label').textContent = `${Math.round(scale * 100)}%`;
  }

  private toggleLoop(): void {
    if (!this.arr) return;
    if (this.player.loop) { this.player.clearLoop(); this.beginner.highlightBars(0, 0, false); $('#btn-loop').classList.remove('active'); return; }
    const bar = Math.floor(this.player.beat / this.arr.beatsPerBar);
    const start = Math.floor(bar / 4) * 4, end = Math.min(this.arr.totalBars - 1, start + 3);
    this.player.setLoop(start, end);
    this.beginner.highlightBars(start, end, true);
    $('#btn-loop').classList.add('active');
  }

  private onPosition(beat: number): void {
    this.piano.setPosition(beat);
    if (this.sheetTab === 'beginner') this.beginner.setPosition(beat); else this.advanced.setPosition(beat);
  }

  private onWaiting(required: Note[] | null): void {
    this.piano.setHints(required);
    this.beginner.setRequired(required);
    $('#status').textContent = required ? `Play: ${required.map((n) => `${n.letter}${n.octave}`).join(' + ')}` : '';
  }

  private onFeedback(midi: number, correct: boolean): void {
    if (correct) return;
    this.piano.setKeyState(midi, 'wrong');
    const prev = this.lastFeedbackTimers.get(midi); if (prev) clearTimeout(prev);
    this.lastFeedbackTimers.set(midi, window.setTimeout(() => this.piano.setKeyState(midi, this.bus.held.has(midi) ? 'user' : 'off'), 350));
  }

  private handAt(midi: number, beat: number): Hand | undefined {
    const lvl = this.level; if (!lvl) return undefined;
    const n = lvl.notes.find((x) => x.midi === midi && beat >= x.startBeat - 0.15 && beat < x.startBeat + x.durationBeats + 0.05);
    return n?.hand;
  }

  // ───────────────────────── misc ─────────────────────────

  private refreshKeyLabels(): void {
    const labels = new Map<number, string>();
    for (let m = 21; m <= 108; m++) { const l = this.keyboard.labelFor(m); if (l) labels.set(m, l); }
    this.piano.setKeyLabels(labels);
    $('#octave-badge').textContent = `Keys Z–/ start at C${Math.floor(this.keyboard.baseMidi / 12) - 1} · ←/→ to shift`;
  }

  private async connectMidi(): Promise<void> {
    if (!this.midi.supported) return;
    try { await this.midi.connect(); this.fillDevices(); } catch (err) { this.toast(msg(err), true); }
  }

  private fillDevices(): void {
    const sel = $<HTMLSelectElement>('#midi-devices');
    const devices = this.midi.devices();
    sel.innerHTML = `<option value="">${devices.length ? 'MIDI keyboard…' : 'No MIDI devices found'}</option>`;
    for (const d of devices) { const o = document.createElement('option'); o.value = d.id; o.textContent = d.name; sel.appendChild(o); }
    if (this.midi.activeId) sel.value = this.midi.activeId;
  }

  private toastTimer = 0;
  private toast(text: string, error = false): void {
    const t = $('#toast');
    t.textContent = text; t.classList.toggle('error', error); t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { t.hidden = true; }, error ? 6000 : 3500);
    if (error) console.error(text);
  }
}

/** Catalog hits above this count are noise: "sonata" matches a hundred Mutopia pieces, the best twenty is plenty. */
const MAX_CATALOG_HITS = 20;

function catalogResult(c: CatalogEntry, relevance?: number, fit?: CatalogFit): SearchResult {
  const r: SearchResult = { id: c.id, name: `${c.title} — ${c.composer}`, downloadUrl: '', source: 'catalog', relevance };
  if (isMidiEntry(c)) { r.origin = c.origin; r.detail = describeLength(c); r.downloadUrl = c.url; }
  if (fit) r.fit = { label: fit.fit.label, tone: fitTone(fit.fit), title: `Stage ${fit.suggested}: ${fit.fit.detail}` };
  return r;
}
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function readFlag(key: string): boolean { try { return localStorage.getItem(key) === '1'; } catch { return false; } }
function writeFlag(key: string, on: boolean): void { try { on ? localStorage.setItem(key, '1') : localStorage.removeItem(key); } catch { /* private mode */ } }
