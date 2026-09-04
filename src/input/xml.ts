/**
 * A small XML reader: enough for MusicXML (elements, attributes, text, comments,
 * processing instructions, a DOCTYPE line, the five standard entities). No DOMParser so
 * it runs in tests and workers alike.
 */

export interface XmlNode { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string }

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(parseInt(e[1] === 'x' || e[1] === 'X' ? e.slice(2) : e.slice(1), e[1] === 'x' || e[1] === 'X' ? 16 : 10));
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseXml(src: string): XmlNode {
  const root: XmlNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += decodeXml(src.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += decodeXml(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) { const end = src.indexOf('-->', lt); i = end < 0 ? n : end + 3; continue; }
    if (src.startsWith('<![CDATA[', lt)) { const end = src.indexOf(']]>', lt); stack[stack.length - 1].text += src.slice(lt + 9, end < 0 ? n : end); i = end < 0 ? n : end + 3; continue; }
    if (src.startsWith('<?', lt) || src.startsWith('<!', lt)) { const end = src.indexOf('>', lt); i = end < 0 ? n : end + 1; continue; }
    const gt = findTagEnd(src, lt);
    const tag = src.slice(lt + 1, gt);
    i = gt + 1;
    if (tag[0] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const selfClose = tag.endsWith('/');
    const body = selfClose ? tag.slice(0, -1) : tag;
    const m = /^([^\s]+)\s*([\s\S]*)$/.exec(body.trim());
    if (!m) continue;
    const node: XmlNode = { name: m[1], attrs: {}, children: [], text: '' };
    for (const a of m[2].matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) node.attrs[a[1]] = decodeXml(a[2] ?? a[3] ?? '');
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/** Index of the '>' that closes the tag starting at `lt`, skipping quoted attribute values. */
function findTagEnd(src: string, lt: number): number {
  let q: string | null = null;
  for (let j = lt + 1; j < src.length; j++) {
    const ch = src[j];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") q = ch;
    else if (ch === '>') return j;
  }
  return src.length - 1;
}

export function child(node: XmlNode, name: string): XmlNode | undefined { return node.children.find((c) => c.name === name); }
export function children(node: XmlNode, name: string): XmlNode[] { return node.children.filter((c) => c.name === name); }
export function textOf(node: XmlNode | undefined, name?: string): string { const t = name ? child(node!, name) : node; return (t?.text ?? '').trim(); }
