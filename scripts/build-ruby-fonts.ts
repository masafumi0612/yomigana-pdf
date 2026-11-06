// ルビに使う、仮名だけのフォント src/assets/fonts/ruby-serif.woff2・ruby-sans.woff2 を作る。
//   npm run fonts:build
// 元のフォント（Noto Serif JP・Noto Sans JP の可変フォント。どちらも SIL OFL 1.1）は、
// リポジトリの外の環境変数 RUBY_FONT_SRC_DIR のフォルダ（なければ C:/Windows/Fonts）から読む。
// 太さ 400 に当てて仮名だけの部分集合にし、縦書きの送りの表を足して、WOFF2 に包む（できたファイルをコミットする）
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

import { SubsetFont } from './test-pdfs/subset-font.ts';

/** 作るフォント：元の family（subset-font.ts の名前）・書き出すファイル・新しい family の名前 */
const OUTPUTS = [
  { source: 'TP Serif', file: 'ruby-serif.woff2', family: 'Yomigana Ruby Serif' },
  { source: 'TP Sans', file: 'ruby-sans.woff2', family: 'Yomigana Ruby Sans' },
] as const;
/** 入れる字の範囲（両端を含む）：平仮名・片仮名（小書きの字・濁点つきの字・長音・踊り字を含む） */
const KANA_RANGES: readonly (readonly [number, number])[] = [
  [0x3041, 0x3096],
  [0x309d, 0x309e],
  [0x30a1, 0x30fe],
];
const FONT_WEIGHT = 400;
const OFL_URL = 'https://openfontlicense.org';

// OpenType の表を書くときの長さ・決まった値
const SFNT_HEADER_BYTES = 12;
const SFNT_RECORD_BYTES = 16;
const WOFF2_HEADER_BYTES = 48;
const WOFF2_SIGNATURE = 0x774f4632;
const ALIGN = 4;
const SFNT_VERSION = 0x00010000;
const CMAP_HEADER_BYTES = 12;
const NAME_RECORD_BYTES = 12;
const OS2_BYTES = 96;
/** 名前の表の言語：Windows の英語（米国） */
const LANGUAGE_EN_US = 0x409;
/** OS/2 の fsSelection：REGULAR */
const FS_REGULAR = 0x40;
/** OS/2 の Unicode の範囲（上位32ビット）：平仮名（49）・片仮名（50） */
const RANGE_HIRAGANA_KATAKANA = (1 << 17) | (1 << 18);
/** OS/2 の文字コードの範囲：日本語（JIS） */
const CODE_PAGE_JIS = 1 << 17;
/** WOFF2 の表の印の番号（決まった並び）。glyf・loca は変換なし（3）で入れる */
const WOFF2_TAGS: Readonly<Record<string, number>> = {
  cmap: 0,
  head: 1,
  hhea: 2,
  hmtx: 3,
  maxp: 4,
  name: 5,
  'OS/2': 6,
  post: 7,
  glyf: 10,
  loca: 11,
  vhea: 23,
  vmtx: 24,
};
const WOFF2_NULL_TRANSFORM = 3;
// 縦書きの送りの表（vhea・vmtx）。この表がないと、Chrome は縦書きの1字の送りを
// 字の上と下の高さの和（明朝は約 1.44 字）にして、ルビの字の間が空き、隣のルビに重なる
const VHEA_BYTES = 36;
const VHEA_VERSION = 0x00010000;
const VMTX_RECORD_BYTES = 4;
/** 縦書きの字の上の端（字の大きさに対する割合）。和文の字の枠（下 0.12・上 0.88）の上の端 */
const VERTICAL_ORIGIN_EM = 0.88;
// head・maxp・glyf の中の場所（バイト）
const HEAD_INDEX_TO_LOC_FORMAT = 50;
const MAXP_NUM_GLYPHS = 4;
const GLYF_Y_MIN = 4;
const GLYF_Y_MAX = 8;
const WOFF2_TRANSFORM_SHIFT = 6;
const BASE128_BITS = 7;

/** 表の名前と中身 */
type Tables = Map<string, Uint8Array>;

/**
 * 決まった長さのバイト列を DataView で書いて作る。
 * @param size 長さ
 * @param build DataView に書く関数
 * @returns 書いたバイト列
 */
function bytes(size: number, build: (view: DataView) => void): Uint8Array {
  const out = new Uint8Array(size);
  build(new DataView(out.buffer));
  return out;
}

/**
 * 4バイトの区切りまで 0 でうめる。
 * @param data 中身
 * @returns うめた中身
 */
function pad4(data: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(data.length / ALIGN) * ALIGN);
  out.set(data);
  return out;
}

/**
 * 部分集合の字を、文字の番号から字形の番号へ引く cmap（format 4）にする。
 * @param glyphOf 文字の番号と字形の番号の組（文字の番号の順）
 * @returns cmap の表
 */
function buildCmap(glyphOf: readonly (readonly [number, number])[]): Uint8Array {
  // 文字の番号と字形の番号が同じ幅で続く並びを、1つの区間にする
  const segments: { start: number; end: number; delta: number }[] = [];
  for (const [code, glyph] of glyphOf) {
    const last = segments.at(-1);
    if (last !== undefined && code === last.end + 1 && glyph - code === last.delta) last.end = code;
    else segments.push({ start: code, end: code, delta: glyph - code });
  }
  segments.push({ start: 0xffff, end: 0xffff, delta: 1 });
  const count = segments.length;
  const subtableBytes = 16 + count * 8;
  const selector = Math.floor(Math.log2(count));
  const searchRange = 2 * 2 ** selector;
  return bytes(CMAP_HEADER_BYTES + subtableBytes, (v) => {
    // 版 0・表の数 1・Windows（3）の Unicode BMP（1）・表の場所
    for (const [i, x] of [0, 1, 3, 1].entries()) v.setUint16(i * 2, x);
    v.setUint32(8, CMAP_HEADER_BYTES);
    const head = [4, subtableBytes, 0, count * 2, searchRange, selector, count * 2 - searchRange];
    for (const [i, x] of head.entries()) v.setUint16(CMAP_HEADER_BYTES + i * 2, x);
    const ends = CMAP_HEADER_BYTES + 14;
    const starts = ends + count * 2 + 2;
    const deltas = starts + count * 2;
    const offsets = deltas + count * 2;
    for (const [i, s] of segments.entries()) {
      v.setUint16(ends + i * 2, s.end);
      v.setUint16(starts + i * 2, s.start);
      v.setUint16(deltas + i * 2, s.delta & 0xffff);
      v.setUint16(offsets + i * 2, 0);
    }
  });
}

/**
 * name の表を作る（Windows・Unicode BMP・英語）。
 * @param strings 名前の番号 → 文字
 * @returns name の表
 */
function buildName(strings: ReadonlyMap<number, string>): Uint8Array {
  const entries = [...strings].sort(([a], [b]) => a - b);
  const header = 6 + entries.length * NAME_RECORD_BYTES;
  const encoded = entries.map(([, text]) =>
    bytes(text.length * 2, (v) => {
      for (let i = 0; i < text.length; i++) v.setUint16(i * 2, text.charCodeAt(i));
    }),
  );
  const out = new Uint8Array(header + encoded.reduce((sum, e) => sum + e.length, 0));
  const v = new DataView(out.buffer);
  v.setUint16(2, entries.length);
  v.setUint16(4, header);
  let offset = 0;
  for (const [i, [id]] of entries.entries()) {
    const text = encoded[i] ?? new Uint8Array(0);
    const record = [3, 1, LANGUAGE_EN_US, id, text.length, offset];
    for (const [j, x] of record.entries()) v.setUint16(6 + i * NAME_RECORD_BYTES + j * 2, x);
    out.set(text, header + offset);
    offset += text.length;
  }
  return out;
}

/**
 * OS/2 の表（版 4）を作る。
 * @param ascent 字の上の長さ
 * @param descent 字の下の長さ（正の数）
 * @param first 入れた字の最初の番号
 * @param last 入れた字の最後の番号
 * @returns OS/2 の表
 */
function buildOs2(ascent: number, descent: number, first: number, last: number): Uint8Array {
  return bytes(OS2_BYTES, (v) => {
    v.setUint16(0, 4);
    v.setUint16(4, FONT_WEIGHT);
    v.setUint16(6, 5);
    v.setUint32(46, RANGE_HIRAGANA_KATAKANA);
    v.setUint16(62, FS_REGULAR);
    v.setUint16(64, first);
    v.setUint16(66, last);
    v.setInt16(68, ascent);
    v.setInt16(70, -descent);
    v.setUint16(74, ascent);
    v.setUint16(76, descent);
    v.setUint32(78, CODE_PAGE_JIS);
  });
}

/**
 * 表の中身をそろえて並べたときの長さ。
 * @param tables 表の名前と中身
 * @returns 長さ（バイト）
 */
function sfntBodyBytes(tables: Tables): number {
  return [...tables.values()].reduce((sum, table) => sum + pad4(table).length, 0);
}

/**
 * WOFF2 の UIntBase128 で数を書く。
 * @param value 数
 * @returns バイト列
 */
function base128(value: number): number[] {
  const out = [value % 2 ** BASE128_BITS];
  for (let rest = Math.floor(value / 2 ** BASE128_BITS); rest > 0;) {
    out.unshift((rest % 2 ** BASE128_BITS) | 0x80);
    rest = Math.floor(rest / 2 ** BASE128_BITS);
  }
  return out;
}

/**
 * 表を WOFF2 に包む。glyf・loca は変換せず（変換なしの印 3）、表全体を brotli で縮める。
 * @param tables 表の名前と中身
 * @returns WOFF2 のファイル
 */
function wrapWoff2(tables: Tables): Uint8Array {
  const names = [...tables.keys()].sort();
  const flagOf = (name: string): number => {
    const tag = WOFF2_TAGS[name];
    if (tag === undefined) throw new Error(`${name} の表は WOFF2 の決まった並びにない`);
    return name === 'glyf' || name === 'loca'
      ? tag | (WOFF2_NULL_TRANSFORM << WOFF2_TRANSFORM_SHIFT)
      : tag;
  };
  const directory = names.flatMap((name) => [
    flagOf(name),
    ...base128(tables.get(name)?.length ?? 0),
  ]);
  const raw = Uint8Array.from(names.flatMap((name) => [...(tables.get(name) ?? [])]));
  const compressed = brotliCompressSync(raw, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_FONT,
    },
  });
  const body = pad4(Uint8Array.from([...directory, ...compressed]));
  const out = new Uint8Array(WOFF2_HEADER_BYTES + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, WOFF2_SIGNATURE);
  v.setUint32(4, SFNT_VERSION);
  v.setUint32(8, out.length);
  v.setUint16(12, names.length);
  v.setUint32(16, SFNT_HEADER_BYTES + names.length * SFNT_RECORD_BYTES + sfntBodyBytes(tables));
  v.setUint32(20, compressed.length);
  out.set(body, WOFF2_HEADER_BYTES);
  return out;
}

/**
 * 字形ごとの、上の端と下の端（glyf の外枠）を読む。
 * @param tables 表の名前と中身（head・maxp・loca・glyf がある）
 * @returns 字形の番号の順の、上と下の端。輪郭のない字形は undefined
 */
function glyphYExtents(tables: Tables): ({ yMin: number; yMax: number } | undefined)[] {
  const viewOf = (name: string): DataView => {
    const table = tables.get(name) ?? new Uint8Array(0);
    return new DataView(table.buffer, table.byteOffset, table.byteLength);
  };
  const isLongLoca = viewOf('head').getInt16(HEAD_INDEX_TO_LOC_FORMAT) === 1;
  const count = viewOf('maxp').getUint16(MAXP_NUM_GLYPHS);
  const loca = viewOf('loca');
  const glyf = viewOf('glyf');
  const offsetOf = (index: number): number =>
    isLongLoca ? loca.getUint32(index * 4) : loca.getUint16(index * 2) * 2;
  return Array.from({ length: count }, (_, index) => {
    const start = offsetOf(index);
    if (offsetOf(index + 1) === start) return undefined;
    return { yMin: glyf.getInt16(start + GLYF_Y_MIN), yMax: glyf.getInt16(start + GLYF_Y_MAX) };
  });
}

/**
 * 縦書きの送りの表（vhea・vmtx）を作る。どの字も送りは1字で、字の上の端を和文の字の枠の上の端に合わせる。
 * @param tables 表の名前と中身（head・maxp・loca・glyf がある）
 * @param unitsPerEm 1字の長さ（フォントの単位）
 * @returns vhea と vmtx の表
 */
function buildVerticalMetrics(
  tables: Tables,
  unitsPerEm: number,
): { vhea: Uint8Array; vmtx: Uint8Array } {
  const extents = glyphYExtents(tables);
  const origin = Math.round(unitsPerEm * VERTICAL_ORIGIN_EM);
  const tops = extents.map((extent) => (extent === undefined ? 0 : origin - extent.yMax));
  const drawn = extents.flatMap((extent, index) =>
    extent === undefined ? [] : [{ top: tops[index] ?? 0, height: extent.yMax - extent.yMin }],
  );
  const vmtx = bytes(extents.length * VMTX_RECORD_BYTES, (v) => {
    for (const [index, top] of tops.entries()) {
      v.setUint16(index * VMTX_RECORD_BYTES, unitsPerEm);
      v.setInt16(index * VMTX_RECORD_BYTES + 2, top);
    }
  });
  const vhea = bytes(VHEA_BYTES, (v) => {
    v.setUint32(0, VHEA_VERSION);
    v.setInt16(4, unitsPerEm / 2);
    v.setInt16(6, -unitsPerEm / 2);
    v.setUint16(10, unitsPerEm);
    v.setInt16(12, Math.min(...drawn.map((glyph) => glyph.top)));
    v.setInt16(14, Math.min(...drawn.map((glyph) => unitsPerEm - glyph.top - glyph.height)));
    v.setInt16(16, Math.max(...drawn.map((glyph) => glyph.top + glyph.height)));
    // 縦書きの文字の間の線（カーソル）は横向き
    v.setInt16(20, 1);
    v.setUint16(34, extents.length);
  });
  return { vhea, vmtx };
}

/**
 * subset-font.ts が作る TrueType のファイルから、表を取り出す。
 * @param sfnt フォントのファイル
 * @returns 表の名前と中身
 */
function readTables(sfnt: Uint8Array): Tables {
  const view = new DataView(sfnt.buffer, sfnt.byteOffset, sfnt.byteLength);
  const tables: Tables = new Map();
  for (let i = 0; i < view.getUint16(4); i++) {
    const at = SFNT_HEADER_BYTES + i * SFNT_RECORD_BYTES;
    const tag = String.fromCharCode(...sfnt.slice(at, at + 4));
    const start = view.getUint32(at + 8);
    tables.set(tag, sfnt.slice(start, start + view.getUint32(at + 12)));
  }
  return tables;
}

/**
 * 仮名だけのフォントを作る。
 * @param fontDir 元のフォントのフォルダ
 * @param output 作るフォント
 * @returns WOFF2 のファイル
 */
function buildFont(fontDir: string, output: (typeof OUTPUTS)[number]): Uint8Array {
  const font = new SubsetFont(fontDir, output.source, FONT_WEIGHT);
  const glyphOf: [number, number][] = [];
  for (const [first, last] of KANA_RANGES) {
    for (let code = first; code <= last; code++) {
      if (font.font.hasGlyphForCodePoint(code)) {
        glyphOf.push([code, font.glyphId(String.fromCodePoint(code), false)]);
      }
    }
  }
  const tables = readTables(font.encode());
  const { vhea, vmtx } = buildVerticalMetrics(tables, font.unitsPerEm);
  tables.set('vhea', vhea);
  tables.set('vmtx', vmtx);
  tables.set('cmap', buildCmap(glyphOf));
  tables.set(
    'OS/2',
    buildOs2(font.font.ascent, -font.font.descent, glyphOf[0]?.[0] ?? 0, glyphOf.at(-1)?.[0] ?? 0),
  );
  // post は字形の名前なし（版 3）
  tables.set(
    'post',
    bytes(32, (v) => {
      v.setUint32(0, 0x00030000);
    }),
  );
  const names = new Map([
    [0, `${font.font.copyright} Subset of ${font.font.familyName} (kana only).`],
    [1, output.family],
    [2, 'Regular'],
    [3, `${output.family} Regular`],
    [4, `${output.family} Regular`],
    [5, 'Version 1.0'],
    [6, output.family.replaceAll(' ', '')],
    [13, 'This Font Software is licensed under the SIL Open Font License, Version 1.1.'],
    [14, OFL_URL],
  ]);
  tables.set('name', buildName(names));
  return wrapWoff2(tables);
}

const fontDir = process.env.RUBY_FONT_SRC_DIR ?? 'C:/Windows/Fonts';
const outDir = fileURLToPath(new URL('../src/assets/fonts/', import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const output of OUTPUTS) {
  const woff2 = buildFont(fontDir, output);
  writeFileSync(join(outDir, output.file), woff2);
  console.log(`${output.file}: ${String(woff2.length)} バイト`);
}
