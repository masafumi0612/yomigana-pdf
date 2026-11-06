// ルビを付ける所（文の位置）を、紙面の上の箱にする。
// 縦書きは字の右、横書きは字の上に置く。行間がせまく隣の行に重なるときは、ルビを少し小さくする。
// 同じ行の中では、隣のルビと重ならないように、まとめる・ずらす・縮める（ruby-line-fit.ts）。
// 箱はページの左上からの長さ（PDF の単位）で出し、画面では pdf.js の倍率（--total-scale-factor）をかける。
import { unionRect } from '@/pdf/rect';
import type { Glyph, Rect, TextBlock } from '@/pdf/types';
import type { RubySpan, RubyWord } from '@/text/annotate';

import { splitLines } from './block-lines';
import { fitLine, type LineFit, type LineRuby } from './ruby-line-fit';

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
  /** 親字の大きさ */
  readonly baseSize: number;
  /** 縮める割合（1 なら縮めない）。行間がせまいときと、同じ行の隣のルビを避けるときの割合をかけたもの */
  readonly shrink: number;
  /** ルビの字の大きさ（PDF の単位）。親字の大きさ × 大きさの割合 × 縮める割合で、箱の太さと同じ */
  readonly fontSize: number;
  /** ルビの字を親字の長さに均等に並べるなら true（同じ語の隣り合う字のルビをまとめたもの） */
  readonly isSpread: boolean;
  /** 親字が明朝なら true（ルビも明朝にする）。ゴシックと見分けられないときは false */
  readonly isSerif: boolean;
  /** ルビと親字を合わせて囲む箱（PDF の座標）。ルビの層は押せないので、押した所のルビを位置で探すのに使う */
  readonly area: Rect;
  /** ルビのもとになった語 */
  readonly word: RubyWord;
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
  /**
   * 字のフォントが明朝か
   * @param glyph 字
   * @returns 明朝なら true
   */
  readonly isSerif: (glyph: Glyph) => boolean;
}

/** 行間がせまいときに縮める割合の下限（これより小さくすると読みにくい） */
const MIN_SHRINK = 0.7;
/** 隣の行の字と見なす、親字の外側の端より内側へ入っていてよい長さ（字）。同じ行の字を除くため */
const OWN_LINE_EM = 0.25;
/** 計算の誤差として見のがす長さ（PDF の単位） */
const EPSILON = 1e-9;

/** 行ごとに分けた、ルビを付ける字の1つ分 */
export interface RubySegment {
  /** ルビを付ける字（同じ行の中で、読む順） */
  readonly glyphs: readonly Glyph[];
  /** 字の、かたまりの中の位置（glyphs と同じ順） */
  readonly indexes: readonly number[];
  /** 行の番号 */
  readonly line: number;
  /** この1つ分のルビの文字 */
  readonly ruby: string;
}

/** 行の中に置く1つのルビ（同じ行の隣と合わせる前） */
interface Piece {
  readonly segment: RubySegment;
  readonly word: RubyWord;
  readonly isVertical: boolean;
  /** 親字の箱 */
  readonly base: Rect;
  /** 親字の大きさ */
  readonly baseSize: number;
  /** 縮める前のルビの字の大きさ */
  readonly fullSize: number;
  /** 行間に合わせて縮める割合 */
  readonly shrink: number;
  /** 親字の半分より多くが明朝なら true */
  readonly isSerif: boolean;
  readonly isSpread: boolean;
  /** layoutRubies が返す並びでの順 */
  readonly order: number;
}

/** 1つのルビを置くのに使うもの */
interface PlaceContext {
  readonly obstacles: readonly Rect[];
  readonly options: RubyLayoutOptions;
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
  const context: PlaceContext = {
    obstacles: blocks.flatMap((block) => block.glyphs.map(options.rectOf)),
    options,
  };
  const lines = new Map<string, Piece[]>();
  let order = 0;
  for (const [index, block] of blocks.entries()) {
    const lineOf = lineNumbers(block);
    const isVertical = block.direction === 'vertical';
    for (const span of spans[index] ?? []) {
      for (const segment of segmentsOf(block, span, lineOf)) {
        const key = `${String(index)}:${String(segment.line)}`;
        const line = lines.get(key) ?? [];
        line.push(makePiece(segment, span.word, isVertical, false, order, context));
        lines.set(key, line);
        order++;
      }
    }
  }
  const placed: { order: number; box: RubyBox }[] = [];
  for (const line of lines.values()) {
    const sorted = line.toSorted((a, b) => middleOf(a) - middleOf(b));
    const pieces = mergeSameWord(sorted, context);
    const fits = fitLine(pieces.map(toLineRuby));
    for (const [index, piece] of pieces.entries()) {
      const fit = fits[index];
      if (fit !== undefined) placed.push({ order: piece.order, box: toBox(piece, fit, frame) });
    }
  }
  return placed.toSorted((a, b) => a.order - b.order).map(({ box }) => box);
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
  const found = indexes.flatMap((index) => {
    const glyph = block.glyphs[index];
    return glyph === undefined ? [] : [{ glyph, index, line: lineOf[index] ?? -1 }];
  });
  if (found.length === 0 || found.some(({ glyph }) => glyph.hasRuby)) return [];
  const groups: { glyphs: Glyph[]; indexes: number[]; line: number }[] = [];
  for (const { glyph, index, line } of found) {
    const group = groups.at(-1);
    if (group?.line === line) {
      group.glyphs.push(glyph);
      group.indexes.push(index);
    } else {
      groups.push({ glyphs: [glyph], indexes: [index], line });
    }
  }
  const readings = splitReading(
    span.ruby,
    groups.map((group) => group.glyphs.length),
  );
  return groups.map((group, order) => ({ ...group, ruby: readings[order] ?? '' }));
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
 * 行の中の1つ分のルビの、親字と字の大きさを決める。行間がせまいときは、ここで縮める。
 * @param segment 行の中の1つ分
 * @param word ルビのもとになった語
 * @param isVertical 縦書きか
 * @param isMerged 同じ語の字のルビをまとめたものか。字が親字より短ければ、均等に並べる
 * @param order layoutRubies が返す並びでの順
 * @param context 置くのに使うもの
 * @returns 行の中に置く1つのルビ
 */
function makePiece(
  segment: RubySegment,
  word: RubyWord,
  isVertical: boolean,
  isMerged: boolean,
  order: number,
  context: PlaceContext,
): Piece {
  const base = unionRect(segment.glyphs.map(context.options.rectOf));
  const baseSize = Math.max(...segment.glyphs.map((glyph) => glyph.size));
  const fullSize = baseSize * context.options.sizeRatio;
  const baseLength = lengthAlong(base, isVertical);
  const length = Math.max(baseLength, charCount(segment) * fullSize);
  const room = roomOutside(base, length, isVertical, baseSize, context.obstacles);
  const shrink = room < fullSize ? Math.max(room / fullSize, MIN_SHRINK) : 1;
  const isSpread = isMerged && charCount(segment) * fullSize * shrink <= baseLength + EPSILON;
  const serifCount = segment.glyphs.filter(context.options.isSerif).length;
  return {
    segment,
    word,
    isVertical,
    base,
    baseSize,
    fullSize,
    shrink,
    isSerif: serifCount * 2 > segment.glyphs.length,
    isSpread,
    order,
  };
}

/**
 * 同じ語の隣り合う字のルビが重なるとき、字ごとに置くのをやめ、その連なりをまとめて、合わせた親字の上に置く
 * （熟語のルビ）。字が合わせた親字より短ければ均等に並べ、長ければ合わせた親字の中心から両側にはみ出す。
 * まとめたものが隣の語のルビと重なるときは、まとめたまま、ずらす・縮めるで避ける（fitLine）。
 * @param pieces 同じ行のルビ（読む順）
 * @param context 置くのに使うもの
 * @returns まとめたあとのルビ（読む順）
 */
function mergeSameWord(pieces: readonly Piece[], context: PlaceContext): Piece[] {
  const runs: Piece[][] = [];
  for (const piece of pieces) {
    const run = runs.at(-1);
    const last = run?.at(-1);
    if (run !== undefined && last !== undefined && isJoinable(last, piece)) run.push(piece);
    else runs.push([piece]);
  }
  return runs.flatMap((run) => {
    const [first] = run;
    if (first === undefined || run.length === 1) return run;
    const segment: RubySegment = {
      glyphs: run.flatMap((piece) => piece.segment.glyphs),
      indexes: run.flatMap((piece) => piece.segment.indexes),
      line: first.segment.line,
      ruby: run.map((piece) => piece.segment.ruby).join(''),
    };
    return [makePiece(segment, first.word, first.isVertical, true, first.order, context)];
  });
}

/**
 * 2つのルビを、熟語のルビとしてまとめてよいか。同じ語の隣り合う字で、字ごとに置くと重なるとき。
 * @param previous 前のルビ
 * @param next 次のルビ
 * @returns まとめてよいなら true
 */
function isJoinable(previous: Piece, next: Piece): boolean {
  const lastIndex = previous.segment.indexes.at(-1);
  const isAdjacent = lastIndex !== undefined && next.segment.indexes[0] === lastIndex + 1;
  const previousEnd = middleOf(previous) + textLength(previous) / 2;
  const nextStart = middleOf(next) - textLength(next) / 2;
  return previous.word === next.word && isAdjacent && previousEnd > nextStart + EPSILON;
}

/**
 * ルビの字の数。
 * @param segment 行の中の1つ分
 * @returns 字の数
 */
function charCount(segment: RubySegment): number {
  return Array.from(segment.ruby).length;
}

/**
 * 行間に合わせて縮めたあとの、ルビの字を並べた長さ。
 * @param piece ルビ
 * @returns 長さ
 */
function textLength(piece: Piece): number {
  return charCount(piece.segment) * piece.fullSize * piece.shrink;
}

/**
 * 箱の、行の向きの長さ。
 * @param rect 箱
 * @param isVertical 縦書きか
 * @returns 長さ
 */
function lengthAlong(rect: Rect, isVertical: boolean): number {
  return isVertical ? rect.y2 - rect.y1 : rect.x2 - rect.x1;
}

/**
 * 箱の、行の向きの位置（読む向きに進むほど大きい）。縦書きは下へ、横書きは右へ進む。
 * @param rect 箱
 * @param isVertical 縦書きか
 * @returns 頭の端と終わりの端
 */
function rangeAlong(rect: Rect, isVertical: boolean): { start: number; end: number } {
  return isVertical ? { start: -rect.y2, end: -rect.y1 } : { start: rect.x1, end: rect.x2 };
}

/**
 * 親字の中心の、行の向きの位置。
 * @param piece ルビ
 * @returns 位置
 */
function middleOf(piece: Piece): number {
  const { start, end } = rangeAlong(piece.base, piece.isVertical);
  return (start + end) / 2;
}

/**
 * 行の中に置く1つのルビを、行の向きだけのルビにする。
 * @param piece ルビ
 * @returns 行の向きのルビ
 */
function toLineRuby(piece: Piece): LineRuby {
  const { start, end } = rangeAlong(piece.base, piece.isVertical);
  return {
    baseStart: start,
    baseEnd: end,
    baseSize: piece.baseSize,
    charCount: charCount(piece.segment),
    fontSize: piece.fullSize * piece.shrink,
    isSpread: piece.isSpread,
  };
}

/**
 * 置き直したルビを、親字の外側（縦書きは右、横書きは上）の箱にする。
 * @param piece ルビ
 * @param fit 行の向きの置き場所と、縮める割合
 * @param frame ページの箱
 * @returns 置くルビ
 */
function toBox(piece: Piece, fit: LineFit, frame: PageFrame): RubyBox {
  const { base, isVertical, segment } = piece;
  const shrink = piece.shrink * fit.scale;
  const fontSize = piece.fullSize * shrink;
  const rect: Rect = isVertical
    ? { x1: base.x2, x2: base.x2 + fontSize, y1: -fit.end, y2: -fit.start }
    : { x1: fit.start, x2: fit.end, y1: base.y2, y2: base.y2 + fontSize };
  return {
    base: segment.glyphs.map((glyph) => glyph.ch).join(''),
    ruby: segment.ruby,
    isVertical,
    ...toPageBox(rect, frame),
    baseSize: piece.baseSize,
    shrink,
    fontSize,
    isSpread: piece.isSpread,
    isSerif: piece.isSerif,
    area: unionRect([base, rect]),
    word: piece.word,
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
