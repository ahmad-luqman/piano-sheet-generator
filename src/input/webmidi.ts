import type { InputBus } from './bus';

export interface MidiDevice { id: string; name: string }

/** Web MIDI hardware input. Silently unavailable in browsers without the API. */
export class WebMidiInput {
  private access: MIDIAccess | null = null;
  private active: MIDIInput | null = null;
  onDevicesChanged?: (devices: MidiDevice[]) => void;

  constructor(private bus: InputBus) {}

  get supported(): boolean { return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator; }

  async connect(): Promise<MidiDevice[]> {
    if (!this.supported) throw new Error('Web MIDI is not supported in this browser (Chrome, Edge and Opera support it).');
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.access.onstatechange = () => this.onDevicesChanged?.(this.devices());
    const devices = this.devices();
    if (devices.length && !this.active) this.select(devices[0].id);
    return devices;
  }

  devices(): MidiDevice[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => ({ id: i.id, name: i.name ?? i.id }));
  }

  select(id: string | null): void {
    if (this.active) { this.active.onmidimessage = null; this.active = null; }
    if (!id || !this.access) return;
    const input = this.access.inputs.get(id);
    if (!input) return;
    this.active = input;
    input.onmidimessage = (ev: MIDIMessageEvent) => {
      const d = ev.data;
      if (!d || d.length < 3) return;
      const status = d[0] & 0xf0, note = d[1], vel = d[2];
      if (status === 0x90 && vel > 0) this.bus.noteOn(note, vel / 127, 'midi');
      else if (status === 0x80 || (status === 0x90 && vel === 0)) this.bus.noteOff(note, 'midi');
    };
  }

  get activeId(): string | null { return this.active?.id ?? null; }
}
