import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { parseMusicXml, readMxl, readScoreFile } from '../src/input/musicxml';
import { parseXml } from '../src/input/xml';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <movement-title>Dil &amp; Dil</movement-title>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>165</per-minute></metronome></direction-type><sound tempo="165"/></direction>
      <note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>6</duration><voice>1</voice><staff>1</staff><tie type="start"/></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>D</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><staff>2</staff></note>
      <note><chord/><pitch><step>A</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><staff>2</staff></note>
      <note><grace/><pitch><step>C</step><alter>1</alter><octave>4</octave></pitch><voice>2</voice><staff>2</staff></note>
      <note><pitch><step>B</step><alter>-1</alter><octave>2</octave></pitch><duration>4</duration><voice>2</voice><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>F</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff><tie type="stop"/></note>
      <note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
      <backup><duration>8</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

describe('xml reader', () => {
  it('parses nested elements, attributes, entities and self-closing tags', () => {
    const doc = parseXml('<a x="1" y=\'two &amp; three\'><b/><c>hi &lt;there&gt;</c><!-- no --></a>');
    const a = doc.children[0];
    expect(a.attrs).toEqual({ x: '1', y: 'two & three' });
    expect(a.children.map((c) => c.name)).toEqual(['b', 'c']);
    expect(a.children[1].text).toBe('hi <there>');
  });
});

describe('MusicXML import', () => {
  const song = parseMusicXml(XML, 'fallback');
  it('reads title, tempo, meter and both staves as two tracks', () => {
    expect(song.title).toBe('Dil & Dil');
    expect(song.bpm).toBe(165);
    expect(song.timeSig).toEqual({ num: 4, den: 4 });
    expect(song.tracks.map((t) => t.name)).toEqual(['Piano (right hand)', 'Piano (left hand)']);
    expect(song.source).toBe('musicxml');
  });
  it('places notes in beats, merges ties, keeps chords together, skips grace notes', () => {
    const rh = song.notes.filter((n) => n.track === 0).map((n) => [n.midi, n.startBeat, n.durationBeats]);
    expect(rh).toEqual([[74, 0, 1], [77, 1, 5], [76, 6, 2]]);
    const lh = song.notes.filter((n) => n.track === 1).map((n) => [n.midi, n.startBeat, n.durationBeats]);
    expect(lh).toEqual([[57, 0, 2], [50, 0, 2], [46, 2, 2], [48, 4, 4]]);
    expect(song.totalBeats).toBe(8);
  });
  it('rejects things that are not scores', () => {
    expect(() => parseMusicXml('<html></html>')).toThrow(/Not a MusicXML/);
  });
});

function zip(entries: Record<string, string>): ArrayBuffer {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let offset = 0;
  for (const [name, text] of Object.entries(entries)) {
    const nameB = enc.encode(name), raw = enc.encode(text), comp = new Uint8Array(deflateRawSync(raw));
    const local = new Uint8Array(30 + nameB.length); const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(8, 8, true); dv.setUint32(18, comp.length, true); dv.setUint32(22, raw.length, true); dv.setUint16(26, nameB.length, true); local.set(nameB, 30);
    const cen = new Uint8Array(46 + nameB.length); const cdv = new DataView(cen.buffer);
    cdv.setUint32(0, 0x02014b50, true); cdv.setUint16(10, 8, true); cdv.setUint32(20, comp.length, true); cdv.setUint32(24, raw.length, true); cdv.setUint16(28, nameB.length, true); cdv.setUint32(42, offset, true); cen.set(nameB, 46);
    parts.push(local, comp); central.push(cen); offset += local.length + comp.length;
  }
  const cenLen = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22); const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true); edv.setUint16(8, central.length, true); edv.setUint16(10, central.length, true); edv.setUint32(12, cenLen, true); edv.setUint32(16, offset, true);
  const all = [...parts, ...central, eocd]; const out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
  return out.buffer;
}

describe('.mxl and file sniffing', () => {
  it('unzips and follows container.xml to the score', async () => {
    const data = zip({ 'META-INF/container.xml': '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>', 'score.xml': XML });
    expect(await readMxl(data)).toBe(XML);
    const sniffed = await readScoreFile(data, 'song.mxl');
    expect(sniffed.kind).toBe('musicxml');
    expect(parseMusicXml(sniffed.xml!).bpm).toBe(165);
  });
  it('tells MIDI from XML from junk', async () => {
    expect((await readScoreFile(new TextEncoder().encode('MThd\0\0').buffer, 'a.mid')).kind).toBe('midi');
    expect((await readScoreFile(new TextEncoder().encode(XML).buffer, 'a.musicxml')).kind).toBe('musicxml');
    await expect(readScoreFile(new TextEncoder().encode('hello').buffer, 'a.txt')).rejects.toThrow(/not a MIDI/);
  });
});
