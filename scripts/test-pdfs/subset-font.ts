import { join } from 'node:path';

import type { Font, Path } from 'fontkit';
import { openSync } from 'fontkit';

/** PDF のフォントの書き方。H = 横書き（Identity-H）、V = 縦書き（Identity-V） */
export type WritingDir = 'H' | 'V';

/**
 * HTML で使う font-family の名前と、フォントのファイル。どちらも SIL Open Font License 1.1。
 * ファイルはリポジトリに入れず、FONT_DIR から読む
 */
export const FONT_FILES: Readonly<Record<string, string>> = {
  'TP Serif': 'NotoSerifJP-VF.ttf',
  'TP Sans': 'NotoSansJP-VF.ttf',
};

/** PDF の幅の単位（1 em = 1000） */
const PDF_EM = 1000;

/** fontkit の Subset のうち、型定義にない中身 */
interface SubsetInternals {
  includeGlyph(glyphId: number): number;
  encode(): Uint8Array;
  glyphEncoder: { encodeSimple: (path: Path) => Uint8Array };
}

/** fontkit の Font のうち、型定義にない中身 */
interface FontInternals {
  namedVariations?: Record<string, Record<string, number>>;
}

// TrueType の glyf の点の印（1 = 曲線の上の点、0 = 曲線の外の制御点）
const ON_CURVE = 1;
const OFF_CURVE = 0;
// 簡単な字形の頭（輪郭の数と外枠の4つ）の長さ（バイト）
const SIMPLE_GLYPH_HEADER_BYTES = 10;
const INT16_BYTES = 2;
// 点ごとに印1バイトと x・y の int16
const BYTES_PER_POINT = 5;
const GLYF_ALIGN = 4;

/**
 * 字形の輪郭を TrueType の簡単な字形（glyf）に書き直す。
 *
 * fontkit 2.0.4 は可変フォントの字形を書き直せない（EncodeStream に数が渡って落ちる）ので、
 * 自分で書く。点はすべて int16 で書き、印を縮める工夫はしない。
 */
export function encodeSimpleGlyph(path: Path): Uint8Array {
  const xs: number[] = [];
  const ys: number[] = [];
  const flags: number[] = [];
  const contourEnds: number[] = [];
  let count = 0;
  for (const c of path.commands) {
    for (let j = 0; j < c.args.length; j += 2) {
      xs.push(Math.round(c.args[j] ?? 0));
      ys.push(Math.round(c.args[j + 1] ?? 0));
      flags.push(c.command === 'quadraticCurveTo' && j === 0 ? OFF_CURVE : ON_CURVE);
      count++;
    }
    if (c.command === 'closePath') contourEnds.push(count - 1);
  }
  if (path.commands.length > 1 && path.commands.at(-1)?.command !== 'closePath') {
    contourEnds.push(count - 1);
  }
  if (!count) return new Uint8Array(0);

  const size =
    SIMPLE_GLYPH_HEADER_BYTES +
    contourEnds.length * INT16_BYTES +
    INT16_BYTES +
    count * BYTES_PER_POINT;
  const buf = new Uint8Array(size + ((GLYF_ALIGN - (size % GLYF_ALIGN)) % GLYF_ALIGN));
  const view = new DataView(buf.buffer);
  let p = 0;
  const writeInt16 = (v: number): void => {
    view.setInt16(p, v);
    p += INT16_BYTES;
  };
  for (const v of [contourEnds.length, Math.min(...xs), Math.min(...ys)]) writeInt16(v);
  for (const v of [Math.max(...xs), Math.max(...ys)]) writeInt16(v);
  for (const v of contourEnds) writeInt16(v);
  // ヒントの命令は入れない
  writeInt16(0);
  for (const f of flags) buf[p++] = f;
  // 座標は1つ前の点からの差で書く
  let last = 0;
  for (const x of xs) {
    writeInt16(x - last);
    last = x;
  }
  last = 0;
  for (const y of ys) {
    writeInt16(y - last);
    last = y;
  }
  return buf;
}

/** 1つのフォント（family と太さの組）と、PDF に入れる部分集合 */
export class SubsetFont {
  /** 太さを当てた fontkit のフォント */
  readonly font: Font;
  /** PDF に書く PostScript 名（例：NotoSerifJP-Bold） */
  readonly psName: string;
  readonly unitsPerEm: number;
  /** 部分集合の字形番号 → その字形が表す文字（ToUnicode に書く） */
  readonly unicode = new Map<number, string>();
  /** 部分集合の字形番号 → 送り幅（1/1000 em） */
  readonly widths = new Map<number, number>();
  /** このフォントを使った書き方 */
  readonly usedDirs = new Set<WritingDir>();
  /** 書き方ごとの PDF のオブジェクト番号（ページを書く前に決める） */
  readonly objectIds = new Map<WritingDir, number>();
  private readonly subset: SubsetInternals;

  constructor(fontDir: string, family: string, weight: number) {
    const file = FONT_FILES[family];
    if (file === undefined) {
      throw new Error(
        `font-family "${family}" は ${Object.keys(FONT_FILES).join(', ')} のどれでもない`,
      );
    }
    const opened = openSync(join(fontDir, file));
    if (!('glyphForCodePoint' in opened)) throw new Error(`${file} はフォント集（TTC）である`);
    const base = opened;
    this.font = base.variationAxes.wght ? base.getVariation({ wght: weight }) : base;
    const named = (base as FontInternals).namedVariations ?? {};
    const instance =
      Object.entries(named).find(([, axes]) => axes.wght === weight)?.[0] ?? `W${String(weight)}`;
    this.psName = `${base.familyName.replace(/\s+/g, '')}-${instance}`;
    this.unitsPerEm = this.font.unitsPerEm;
    this.subset = this.font.createSubset() as unknown as SubsetInternals;
    this.subset.glyphEncoder.encodeSimple = encodeSimpleGlyph;
  }

  /**
   * 1文字を部分集合に入れ、部分集合の字形番号を返す。
   * 縦書きでは、フォントの縦書き用の字形（vert：、。「ー… など）を使う
   */
  glyphId(ch: string, isVertical: boolean): number {
    const codePoint = ch.codePointAt(0) ?? 0;
    const glyph = isVertical
      ? this.font.layout(ch, ['vert']).glyphs[0]
      : this.font.glyphForCodePoint(codePoint);
    if (!glyph?.id) {
      throw new Error(`"${ch}"（U+${codePoint.toString(16)}）の字形が ${this.psName} にない`);
    }
    const id = this.subset.includeGlyph(glyph.id);
    if (!this.unicode.has(id)) this.unicode.set(id, ch);
    this.widths.set(id, (glyph.advanceWidth * PDF_EM) / this.unitsPerEm);
    return id;
  }

  /** 部分集合のフォントファイル（TrueType）を作る */
  encode(): Uint8Array {
    return this.subset.encode();
  }
}

/** 1つの PDF で使うフォントの集まり */
export class FontSet {
  private readonly fonts = new Map<string, SubsetFont>();
  private readonly fontDir: string;

  // Node が型を取り除くだけで動くように、引数に private を付ける書き方は使わない
  constructor(fontDir: string) {
    this.fontDir = fontDir;
  }

  /** family と太さに合うフォントを返す（初めてなら開く） */
  get(family: string, weight: number): SubsetFont {
    const key = `${family}|${String(weight)}`;
    let font = this.fonts.get(key);
    if (!font) {
      font = new SubsetFont(this.fontDir, family, weight);
      this.fonts.set(key, font);
    }
    return font;
  }

  /** 開いた順のフォント */
  all(): SubsetFont[] {
    return [...this.fonts.values()];
  }

  /** PDF の中でのフォントの名前（例：F1H） */
  resourceName(font: SubsetFont, dir: WritingDir): string {
    return `F${String(this.all().indexOf(font) + 1)}${dir}`;
  }
}
