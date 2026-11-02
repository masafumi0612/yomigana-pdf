import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

import type { FontSet, SubsetFont, WritingDir } from './subset-font.ts';

/** PDF の幅の単位（1 em = 1000） */
const PDF_EM = 1000;
// 縦書きの字の送りと、字の原点（上の中央）から基準線までの長さ（1/1000 em）。
// 和文フォントの em の箱は、上から 0.88 em のところに基準線がある
const VERTICAL_METRICS = '[880 -1000]';
// ToUnicode の bfchar は1つのまとまりに 100 個まで
const BFCHAR_LIMIT = 100;
// 部分集合のフォント名の頭に付ける6文字の英大文字
const SUBSET_TAG_LENGTH = 6;
const ALPHABET_SIZE = 26;
const CHAR_CODE_A = 65;
// 小数点以下の桁数と、0 と見なす小ささ
const DECIMALS = 3;
const EPSILON = 1e-6;
const XREF_OFFSET_DIGITS = 10;
// UTF-16 のサロゲートペア
const BMP_END = 0x1_00_00;
const HIGH_SURROGATE = 0xd8_00;
const LOW_SURROGATE = 0xdc_00;
const SURROGATE_BITS = 10;
const SURROGATE_MASK = 0x3_ff;
const HEX_DIGITS = 4;
// 大文字の高さがフォントにないときに使う値（1/1000 em）
const DEFAULT_CAP_HEIGHT = 700;

/** 数を PDF に書く形にする（小数点以下3桁まで、-0 は 0） */
export function num(n: number): string {
  return Math.abs(n) < EPSILON ? '0' : Number(n.toFixed(DECIMALS)).toString();
}

/** 数を4桁の16進にする */
export function hex4(n: number): string {
  return n.toString(16).padStart(HEX_DIGITS, '0');
}

/** 文字列を UTF-16BE の16進にする（BOM なし） */
function utf16Hex(s: string): string {
  return Array.from(s)
    .map((c) => {
      const u = c.codePointAt(0) ?? 0;
      if (u < BMP_END) return hex4(u);
      const v = u - BMP_END;
      return (
        hex4((v >> SURROGATE_BITS) + HIGH_SURROGATE) + hex4((v & SURROGATE_MASK) + LOW_SURROGATE)
      );
    })
    .join('');
}

/** 文字列を PDF の文字列（BOM 付き UTF-16BE の16進）にする */
export function pdfText(s: string): string {
  return `<feff${utf16Hex(s)}>`;
}

/** オブジェクトへの参照（例：12 0 R） */
export function ref(id: number): string {
  return `${String(id)} 0 R`;
}

/** PDF のオブジェクトを番号順に集め、最後に1つのファイルにする */
export class PdfWriter {
  private readonly objects: (Buffer | undefined)[] = [];

  /** 中身を後で入れるオブジェクトの番号を取る */
  reserve(): number {
    this.objects.push(undefined);
    return this.objects.length;
  }

  /** 番号を取ったオブジェクトに中身を入れる */
  put(id: number, body: string | Buffer): number {
    this.objects[id - 1] = typeof body === 'string' ? Buffer.from(body, 'latin1') : body;
    return id;
  }

  /** 新しいオブジェクトを足す */
  add(body: string | Buffer): number {
    return this.put(this.reserve(), body);
  }

  /** Flate で縮めたストリームを足す */
  addStream(dict: string, data: string | Uint8Array): number {
    const z = deflateSync(typeof data === 'string' ? Buffer.from(data) : data);
    return this.addRawStream(`${dict} /Filter /FlateDecode`, z);
  }

  /** そのままのストリーム（JPEG など、縮めてあるもの）を足す */
  addRawStream(dict: string, data: Uint8Array): number {
    const head = Buffer.from(`<< ${dict} /Length ${String(data.length)} >>\nstream\n`, 'latin1');
    return this.add(Buffer.concat([head, data, Buffer.from('\nendstream', 'latin1')]));
  }

  /** 1つの PDF ファイルにする。日時を入れないので、同じ中身からは同じファイルができる */
  toBuffer(rootId: number, infoId: number): Buffer {
    const parts = [Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let pos = parts[0]?.length ?? 0;
    const offsets: number[] = [];
    this.objects.forEach((body, i) => {
      if (!body) throw new Error(`オブジェクト ${String(i + 1)} の中身がない`);
      offsets.push(pos);
      const b = Buffer.concat([
        Buffer.from(`${String(i + 1)} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      parts.push(b);
      pos += b.length;
    });
    const size = String(this.objects.length + 1);
    const xref = [
      'xref',
      `0 ${size}`,
      '0000000000 65535 f ',
      ...offsets.map((o) => `${String(o).padStart(XREF_OFFSET_DIGITS, '0')} 00000 n `),
    ].join('\n');
    const id = createHash('md5').update(Buffer.concat(parts)).digest('hex');
    const trailer = `${xref}\ntrailer\n<< /Size ${size} /Root ${ref(rootId)} /Info ${ref(infoId)} /ID [<${id}> <${id}>] >>\nstartxref\n${String(pos)}\n%%EOF\n`;
    parts.push(Buffer.from(trailer, 'latin1'));
    return Buffer.concat(parts);
  }
}

/** 字形番号から元の文字を引く表（ToUnicode CMap）を作る */
function toUnicodeCMap(font: SubsetFont): string {
  const entries = [...font.unicode].sort((a, b) => a[0] - b[0]);
  const chunks: string[] = [];
  for (let i = 0; i < entries.length; i += BFCHAR_LIMIT) {
    const part = entries.slice(i, i + BFCHAR_LIMIT);
    const lines = part.map(([g, s]) => `<${hex4(g)}> <${utf16Hex(s)}>`).join('\n');
    chunks.push(`${String(part.length)} beginbfchar\n${lines}\nendbfchar`);
  }
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <ffff>
endcodespacerange
${chunks.join('\n')}
endcmap
CMapName currentdict /CMap defineresource pop
end
end`;
}

/** 部分集合のフォント名の頭に付ける6文字（中身から決めるので、作り直しても変わらない） */
function subsetTag(font: SubsetFont): string {
  const digest = createHash('md5')
    .update(font.psName + [...font.unicode.keys()].join(','))
    .digest()
    .subarray(0, SUBSET_TAG_LENGTH);
  return [...digest].map((b) => String.fromCharCode(CHAR_CODE_A + (b % ALPHABET_SIZE))).join('');
}

/**
 * フォントのオブジェクトを書く。すべてのページを並べた後に呼ぶ（部分集合がそろってから）。
 * オブジェクトの番号は、ページを書く前に SubsetFont.objectIds に取っておく
 */
export function writeFonts(pdf: PdfWriter, fonts: FontSet): void {
  for (const font of fonts.all()) {
    const name = `${subsetTag(font)}+${font.psName}`;
    const file = font.encode();
    const f = font.font;
    const k = PDF_EM / font.unitsPerEm;
    const fontFile = pdf.addStream(`/Length1 ${String(file.length)}`, file);
    const bbox = [f.bbox.minX, f.bbox.minY, f.bbox.maxX, f.bbox.maxY]
      .map((v) => String(Math.round(v * k)))
      .join(' ');
    const descriptor = pdf.add(
      `<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${bbox}] /ItalicAngle 0 /Ascent ${String(Math.round(f.ascent * k))} /Descent ${String(Math.round(f.descent * k))} /CapHeight ${String(Math.round((f.capHeight || DEFAULT_CAP_HEIGHT / k) * k))} /StemV 80 /FontFile2 ${ref(fontFile)} >>`,
    );
    const toUnicode = pdf.addStream('', toUnicodeCMap(font));
    const widths = [...font.widths]
      .sort((a, b) => a[0] - b[0])
      .map(([g, v]) => `${String(g)} [${String(Math.round(v))}]`)
      .join(' ');
    const extras: Record<WritingDir, string> = { H: '', V: ` /DW2 ${VERTICAL_METRICS}` };
    for (const [dir, id] of font.objectIds) {
      const cidFont = pdf.add(
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${ref(descriptor)} /DW 1000 /W [${widths}]${extras[dir]} /CIDToGIDMap /Identity >>`,
      );
      pdf.put(
        id,
        `<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-${dir} /DescendantFonts [${ref(cidFont)}] /ToUnicode ${ref(toUnicode)} >>`,
      );
    }
  }
}
