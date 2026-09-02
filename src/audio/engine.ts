import type * as ToneNs from 'tone';

type ToneModule = typeof ToneNs;
let Tone: ToneModule | null = null;

export type EngineState = 'idle' | 'loading' | 'sampler' | 'synth';

const SALAMANDER = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_NOTES = ['A0', 'C1', 'D#1', 'F#1', 'A1', 'C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5', 'A5', 'C6', 'D#6', 'F#6', 'A6', 'C7', 'D#7', 'F#7', 'A7', 'C8'];

/**
 * Piano sound. Sampled Salamander grand when it loads, a warm PolySynth otherwise.
 * All public methods are safe to call before `start()`; they just make no sound.
 */
export class AudioEngine {
  state: EngineState = 'idle';
  private sampler: ToneNs.Sampler | null = null;
  private synth: ToneNs.PolySynth | null = null;
  private metro: ToneNs.MembraneSynth | null = null;
  private out: ToneNs.Volume | null = null;
  private sustainOn = false;
  private sustained = new Set<number>();
  onState?: (s: EngineState) => void;

  get ready(): boolean { return this.state === 'sampler' || this.state === 'synth'; }

  /** Must be called from a user gesture. */
  async start(): Promise<void> {
    if (this.ready || this.state === 'loading') return;
    this.setState('loading');
    // Loaded on demand: Tone creates an AudioContext at import time, which browsers only allow after a gesture.
    Tone = Tone ?? (await import('tone'));
    await Tone.start();
    this.out = new Tone.Volume(-4).toDestination();
    this.synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'triangle' },
      envelope: { attack: 0.005, decay: 0.4, sustain: 0.25, release: 0.8 },
    }).connect(this.out);
    this.synth.maxPolyphony = 32;
    this.metro = new Tone.MembraneSynth({ pitchDecay: 0.01, octaves: 2, envelope: { attack: 0.001, decay: 0.08, sustain: 0 } }).connect(this.out);
    this.setState('synth');
    try {
      const urls: Record<string, string> = {};
      for (const n of SAMPLE_NOTES) urls[n] = `${n.replace('#', 's')}.mp3`;
      const T = Tone;
      const sampler = await new Promise<ToneNs.Sampler>((resolve, reject) => {
        const s = new T.Sampler({ urls, baseUrl: SALAMANDER, release: 1.2, onload: () => resolve(s), onerror: reject });
      });
      sampler.connect(this.out);
      this.sampler = sampler;
      this.setState('sampler');
    } catch (e) {
      console.warn('Piano samples failed to load; using synth', e);
    }
  }

  private setState(s: EngineState) { this.state = s; this.onState?.(s); }

  now(): number { return Tone ? Tone.now() : 0; }

  private inst() { return this.sampler ?? this.synth; }

  noteOn(midi: number, velocity = 0.8, when?: number): void {
    const inst = this.inst();
    if (!inst || !Tone) return;
    const note = Tone.Frequency(midi, 'midi').toNote();
    inst.triggerAttack(note, when ?? Tone.now(), Math.max(0.05, Math.min(1, velocity)));
    this.sustained.delete(midi);
  }

  noteOff(midi: number, when?: number): void {
    const inst = this.inst();
    if (!inst || !Tone) return;
    if (this.sustainOn) { this.sustained.add(midi); return; }
    inst.triggerRelease(Tone.Frequency(midi, 'midi').toNote(), when ?? Tone.now());
  }

  /** Schedule a complete note; `when` is an absolute Tone time. */
  play(midi: number, velocity: number, durationSec: number, when: number): void {
    const inst = this.inst();
    if (!inst || !Tone) return;
    inst.triggerAttackRelease(Tone.Frequency(midi, 'midi').toNote(), Math.max(0.05, durationSec), when, Math.max(0.05, Math.min(1, velocity)));
  }

  click(accent: boolean, when: number): void {
    this.metro?.triggerAttackRelease(accent ? 'C4' : 'G3', 0.05, when, accent ? 0.7 : 0.4);
  }

  setSustain(on: boolean): void {
    this.sustainOn = on;
    if (!on) { for (const m of this.sustained) this.noteOff(m); this.sustained.clear(); }
  }

  releaseAll(): void {
    this.sampler?.releaseAll();
    this.synth?.releaseAll();
    this.sustained.clear();
  }

  setVolumeDb(db: number): void { if (this.out) this.out.volume.value = db; }
}
