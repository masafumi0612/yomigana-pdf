// ルビを付ける所（文の位置）を、紙面の上の箱にする。
// 縦書きは字の右、横書きは字の上に置く。行間がせまく隣の行に重なるときは、ルビを少し小さくする。
// 箱はページの左上からの長さ（PDF の単位）で出し、画面では pdf.js の倍率（--total-scale-factor）をかける。
import { unionRect } from '@/pdf/rect';
import type { Glyph, Rect, TextBlock } from '@/pdf/types';
import type { RubySpan } from '@/text/annotate';

import { splitLines } from './block-lines';

/** ページの箱（pdf.js の viewport.rawDims と同じ形。PDF の座標） */
export interface PageFrame {
  /** 左の端 */
  readonly pageX: number;
  /** 下の端 */
  readonly pageY: number;
  /** 幅 */
  readonly pageWidth: number;
  /** 高さ */
  readonly pageHeight: number;
}

/** 紙面に置く1つのルビ。長さはページの左上からの PDF の単位（回す前のページの向き） */
export interface RubyBox {
  /** ルビを付ける字 */
  readonly base: string;
  /** ルビの文字 */
  readonly ruby: string;
  /** 縦書き（字の右に縦に並べる）なら true */
  readonly isVertical: boolean;
  /** 左の端 */
  readonly left: number;
  /** 上の端 */
  readonly top: number;
  /** 幅 */
  readonly width: number;
  /** 高さ */
  readonly height: number;
  /** 親字の大きさ。ルビの字の大きさは、これに大きさの割合と縮める割合をかけたもの */
  readonly baseSize: number;
  /** 行間がせまいときに縮める割合（1 なら縮めない） */
  readonly shrink: number;
}

/** ルビの置き方 */
export interface RubyLayoutOptions {
  /** ルビの字の大きさの、親字に対する割合 */
  readonly sizeRatio: number;
  /**
   * 字の箱を引く。描いた位置が分かる字は、その箱を返す
   * @param glyph 字
   * @returns 字の箱（PDF の座標）
   */
  readonly rectOf: (glyph: Glyph) => Rect;
}

/** 行間がせまいときに縮める割合の下限（これより小さくすると読みにくい） */
const MIN_SHRINK = 0.7;
/** 隣の行の字と見なす、親字の外側の端より内側へ入っていてよい長さ（字）。同じ行の字を除くため */
const OWN_LINE_EM = 0.25;

/** 行ごとに分けた、ルビを付ける字の1つ分 */
export interface RubySegment {
  /** ルビを付ける字（同じ行の中で、読む順） */
  readonly glyphs: readonly Glyph[];
  /** この1つ分のルビの文字 */
  readonly ruby: string;
}

/**
 * 1ページのルビの置き場所を出す。もとからルビのある字（hasRuby）にかかる所には付けない。
 * @param blocks ページのかたまり
 * @param spans かたまりごとの、ルビを付ける所（blocks と同じ順）
 * @param frame ページの箱
 * @param options ルビの置き方
 * @returns 置くルビ
 */
export function layoutRubies(
  blocks: readonly TextBlock[],
  spans: readonly (readonly RubySpan[])[],
  frame: PageFrame,
  options: RubyLayoutOptions,
): RubyBox[] {
  const obstacles = blocks.flatMap((block) => block.glyphs.map(options.rectOf));
  const boxes: RubyBox[] = [];
  for (const [index, block] of blocks.entries()) {
    const lineOf = lineNumbers(block);
    for (const span of spans[index] ?? []) {
      for (const segment of segmentsOf(block, span, lineOf)) {
        boxes.push(placeSegment(segment, block, obstacles, frame, options));
      }
    }
  }
  return boxes;
}

/**
 * かたまりの字ごとの、行の番号。
 * @param block かたまり
 * @returns glyphs と同じ順の行の番号
 */
function lineNumbers(block: TextBlock): number[] {
  const lineOf: number[] = [];
  for (const [line, indexes] of splitLines(block.glyphs, block.direction).entries()) {
    for (const index of indexes) lineOf[index] = line;
  }
  return lineOf;
}

/**
 * ルビを付ける所を、行ごとの1つ分に分ける。行をまたぐときは、ルビの文字を字の数の割合で分ける。
 * @param block かたまり
 * @param span ルビを付ける所
 * @param lineOf 字ごとの行の番号
 * @returns 行ごとの1つ分。もとからルビのある字にかかるときは空
 */
export function segmentsOf(
  block: TextBlock,
  span: RubySpan,
  lineOf: readonly number[],
): RubySegment[] {
  const indexes = [...new Set(block.glyphIndexOfChar.slice(span.start, span.end))];
  const glyphs = indexes.flatMap((index) => block.glyphs[index] ?? []);
  if (glyphs.length === 0 || glyphs.some((glyph) => glyph.hasRuby)) return [];
  const groups: Glyph[][] = [];
  let previousLine: number | undefined;
  for (const [order, glyph] of glyphs.entries()) {
    const line = lineOf[indexes[order] ?? -1];
    const group = groups.at(-1);
    if (group === undefined || line !== previousLine) groups.push([glyph]);
    else group.push(glyph);
    previousLine = line;
  }
  const readings = splitReading(
    span.ruby,
    groups.map((group) => group.length),
  );
  return groups.map((group, order) => ({ glyphs: group, ruby: readings[order] ?? '' }));
}

/**
 * ルビの文字を、字の数の割合で分ける。
 * @param ruby ルビの文字
 * @param counts 分ける先ごとの字の数
 * @returns counts と同じ数のルビの文字
 */
export function splitReading(ruby: string, counts: readonly number[]): string[] {
  const chars = Array.from(ruby);
  const total = counts.reduce((sum, count) => sum + count, 0);
  const parts: string[] = [];
  let done = 0;
  let cut = 0;
  for (const count of counts) {
    done += count;
    const next = Math.round((chars.length * done) / total);
    parts.push(chars.slice(cut, next).join(''));
    cut = next;
  }
  return parts;
}

/**
 * 行の中の1つ分のルビを、親字の外側（縦書きは右、横書きは上）に置く。
 * @param segment 行の中の1つ分
 * @param block かたまり（向きを見る）
 * @param obstacles ページのすべての字の箱
 * @param frame ページの箱
 * @param options ルビの置き方
 * @returns 置くルビ
 */
function placeSegment(
  segment: RubySegment,
  block: Pick<TextBlock, 'direction'>,
  obstacles: readonly Rect[],
  frame: PageFrame,
  options: RubyLayoutOptions,
): RubyBox {
  const isVertical = block.direction === 'vertical';
  const base = unionRect(segment.glyphs.map(options.rectOf));
  const baseSize = Math.max(...segment.glyphs.map((glyph) => glyph.size));
  const fullSize = baseSize * options.sizeRatio;
  const length = Math.max(
    isVertical ? base.y2 - base.y1 : base.x2 - base.x1,
    Array.from(segment.ruby).length * fullSize,
  );
  const room = roomOutside(base, length, isVertical, baseSize, obstacles);
  const shrink = room < fullSize ? Math.max(room / fullSize, MIN_SHRINK) : 1;
  const thickness = fullSize * shrink;
  const rect: Rect = isVertical
    ? {
        x1: base.x2,
        x2: base.x2 + thickness,
        y1: (base.y1 + base.y2 - length) / 2,
        y2: (base.y1 + base.y2 + length) / 2,
      }
    : {
        x1: (base.x1 + base.x2 - length) / 2,
        x2: (base.x1 + base.x2 + length) / 2,
        y1: base.y2,
        y2: base.y2 + thickness,
      };
  return {
    base: segment.glyphs.map((glyph) => glyph.ch).join(''),
    ruby: segment.ruby,
    isVertical,
    ...toPageBox(rect, frame),
    baseSize,
    shrink,
  };
}

/**
 * 親字の外側（縦書きは右、横書きは上）に、隣の行の字までどれだけ空いているか。
 * @param base 親字の箱
 * @param length ルビの長さ（親字の中心から両側に広げる）
 * @param isVertical 縦書きか
 * @param size 親字の大きさ
 * @param obstacles ページのすべての字の箱
 * @returns 空いている長さ。隣の行の字がなければ Infinity
 */
export function roomOutside(
  base: Rect,
  length: number,
  isVertical: boolean,
  size: number,
  obstacles: readonly Rect[],
): number {
  const edge = isVertical ? base.x2 : base.y2;
  const middle = isVertical ? (base.y1 + base.y2) / 2 : (base.x1 + base.x2) / 2;
  let room = Infinity;
  for (const other of obstacles) {
    const near = isVertical ? other.x1 : other.y1;
    const [lo, hi] = isVertical ? [other.y1, other.y2] : [other.x1, other.x2];
    const isAlongside = hi > middle - length / 2 && lo < middle + length / 2;
    if (isAlongside && near >= edge - size * OWN_LINE_EM) {
      room = Math.min(room, Math.max(near - edge, 0));
    }
  }
  return room;
}

/**
 * PDF の座標の箱を、ページの左上からの長さにする（y は下へ向く）。
 * @param rect 箱（PDF の座標）
 * @param frame ページの箱
 * @returns 左の端・上の端・幅・高さ（PDF の単位）
 */
export function toPageBox(
  rect: Rect,
  frame: PageFrame,
): { left: number; top: number; width: number; height: number } {
  return {
    left: rect.x1 - frame.pageX,
    top: frame.pageY + frame.pageHeight - rect.y2,
    width: rect.x2 - rect.x1,
    height: rect.y2 - rect.y1,
  };
}
