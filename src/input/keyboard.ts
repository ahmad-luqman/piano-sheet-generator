import type { InputBus } from './bus';

/**
 * Computer keyboard → piano. Two rows: the bottom row (Z X C V B N M , . /) is white
 * keys from the base octave, top row (A S D F G H J K L ;) is white keys one octave up;
 * the black keys sit on the row above each (S D G H J and W E T Y U respectively).
 * Layout mirrors a real keyboard: black keys sit between their white neighbours.
 */
const LOWER_WHITE = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'];
const LOWER_BLACK: Record<string, number> = { KeyS: 1, KeyD: 3, KeyG: 6, KeyH: 8, KeyJ: 10, KeyL: 13, Semicolon: 15 };
const UPPER_WHITE = ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP'];
const UPPER_BLACK: Record<string, number> = { Digit2: 1, Digit3: 3, Digit5: 6, Digit6: 8, Digit7: 10, Digit9: 13, Digit0: 15 };
const WHITE_OFFSETS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16];

export class ComputerKeyboard {
  baseMidi = 48; // C3 for the lower row; upper row starts at C4
  private down = new Map<string, number>();
  onOctaveChange?: (base: number) => void;
  sustain = false;
  onSustain?: (down: boolean) => void;

  constructor(private bus: InputBus, private isTypingTarget: (t: EventTarget | null) => boolean) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.releaseAll());
  }

  midiFor(code: string): number | null {
    const li = LOWER_WHITE.indexOf(code);
    if (li >= 0) return this.baseMidi + WHITE_OFFSETS[li];
    if (code in LOWER_BLACK) return this.baseMidi + LOWER_BLACK[code];
    const ui = UPPER_WHITE.indexOf(code);
    if (ui >= 0) return this.baseMidi + 12 + WHITE_OFFSETS[ui];
    if (code in UPPER_BLACK) return this.baseMidi + 12 + UPPER_BLACK[code];
    return null;
  }

  /** Human-readable label for a key so the UI can print the mapping on the keys. */
  labelFor(midi: number): string | null {
    for (const [code, off] of [...LOWER_WHITE.map((c, i) => [c, WHITE_OFFSETS[i]] as const), ...Object.entries(LOWER_BLACK)]) {
      if (this.baseMidi + off === midi) return codeLabel(code);
    }
    for (const [code, off] of [...UPPER_WHITE.map((c, i) => [c, WHITE_OFFSETS[i]] as const), ...Object.entries(UPPER_BLACK)]) {
      if (this.baseMidi + 12 + off === midi) return codeLabel(code);
    }
    return null;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat) return;
    if (e.code === 'ArrowLeft' || e.code === 'Minus') { this.shiftOctave(-1); e.preventDefault(); return; }
    if (e.code === 'ArrowRight' || e.code === 'Equal') { this.shiftOctave(1); e.preventDefault(); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!this.sustain) { this.sustain = true; this.onSustain?.(true); } return; }
    const midi = this.midiFor(e.code);
    if (midi === null) return;
    e.preventDefault();
    this.down.set(e.code, midi);
    this.bus.noteOn(midi, 0.8, 'keyboard');
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space') { this.sustain = false; this.onSustain?.(false); return; }
    const midi = this.down.get(e.code);
    if (midi === undefined) return;
    this.down.delete(e.code);
    this.bus.noteOff(midi, 'keyboard');
  };

  shiftOctave(dir: number): void {
    this.releaseAll();
    this.baseMidi = Math.max(24, Math.min(72, this.baseMidi + 12 * dir));
    this.onOctaveChange?.(this.baseMidi);
  }

  releaseAll(): void {
    for (const [, midi] of this.down) this.bus.noteOff(midi, 'keyboard');
    this.down.clear();
  }
}

function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { Comma: ',', Period: '.', Slash: '/', Semicolon: ';' }[code] ?? code;
}
