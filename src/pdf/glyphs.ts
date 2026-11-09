// pdf.js の文字の片を、位置つきの字と、片ごとのまとまり（ラン）にする。
// 縦書きの印（dir が ttb・縦書きのフォント）のない縦書き（Word や Chrome の印刷）は、
// 1字ずつの片が、ほぼ同じ x のまま真下へ続く並びから見つける。
import { centerX, unionRect } from './rect';
import type { Direction, PdfMarkedContent, PdfTextContent, PdfTextItem, Rect } from './types';

/** 字の向きの手がかり */
export type Evidence =
  /** 縦書きの印がある */
  | 'mark'
  /** 2字以上の横書きの片（字が横に並ぶ） */
  | 'item'
  /** 1字ずつの片が真下へ続く並び（縦書きと見なした） */
  | 'chain'
  /** 1字だけの片（向きの手がかりがない） */
  | 'lone';

/** 位置つきの1字 */
export interface PlacedGlyph {
  /** PDF の中の字 */
  readonly ch: string;
  /** 判定に使う NFKC の形 */
  readonly norm: string;
  /** 字の箱 */
  readonly rect: Rect;
  /** 字の大きさ */
  readonly size: number;
  /** 向きの手がかり */
  readonly evidence: Evidence;
  /** 字を描くフォントの名前 */
  readonly fontName: string;
}

/** 1つの片（縦書きと見なした並びは、並び全体）の字 */
export interface TextRun {
  /** 並ぶ順の字 */
  readonly glyphs: readonly PlacedGlyph[];
  /** 字をつないだ文字列 */
  readonly text: string;
  /** すべての字を囲む箱 */
  readonly rect: Rect;
  /** 字の大きさ */
  readonly size: number;
  /** 字の並ぶ向き */
  readonly direction: Direction;
}

/** 捨てる字：空白・制御文字・書式の文字 */
const SKIPPED_CHAR = /^[\s\p{Cc}\p{Cf}]$/u;
/**
 * pdf.js が字と字の間の空きに入れる半角の空白。本当の字ではないので、縦書きの片では
 * 1字ぶんの場所を取らせず、残りの長さを分けあう空きとして扱う（全角の空白は1字ぶん）
 */
const GAP_CHAR = /^ $/u;
/** pdf.js が縦書きのフォントの片に付ける向き */
const TOP_TO_BOTTOM = 'ttb';
/** 回っているかを見る、変換の行列の傾きの下限（回した横書きの字は扱わない） */
const ROTATION_EPSILON = 0.01;
/** 横書きの字の箱：基準線から下に 0.12 字、上に 0.88 字 */
const DESCENT_EM = 0.12;
const ASCENT_EM = 0.88;
/** 1字ずつの片が真下へ続くと見なす、横の中心のずれの上限（字） */
const CHAIN_AXIS_EM = 0.3;
/** 真下へ続くと見なす、1字ごとに下がる長さの範囲（字）。字間が空いていても 1.3 字まで */
const CHAIN_STEP_MIN_EM = 0.8;
const CHAIN_STEP_MAX_EM = 1.3;
/** 同じ並びと見なす字の大きさの比の上限 */
const CHAIN_SIZE_RATIO = 1.25;
/** 縦書きの並びと見なす、続く片の数の下限 */
const MIN_CHAIN_LENGTH = 2;
/** 重ねて描いた片と見なす、行と交わる向きの位置（横書きは基準線、縦書きは列の中心）のずれの上限（字） */
const OVERDRAWN_CROSS_EM = 0.2;
/** 重ねて描いた片と見なす、ほかの片の端からはみ出してよい長さ（字） */
const OVERDRAWN_REACH_EM = 0.5;
/** 重ねて描いた片と見なす字の大きさの比の上限 */
const OVERDRAWN_SIZE_RATIO = 1.1;

/** 字にする前の1つの片 */
interface Piece {
  readonly item: PdfTextItem;
  readonly isMarked: boolean;
  /** 空白を含む、片のすべての字 */
  readonly chars: readonly string[];
  /** 捨てない字の数 */
  readonly visible: number;
  /** 捨てない字をつないだ文字列 */
  readonly text: string;
  /** 片の区間と位置 */
  readonly extent: Extent;
}

/** 片の、字の並ぶ向きの区間と、行と交わる向きの位置 */
interface Extent {
  /** 字の並ぶ向きの始まり */
  readonly start: number;
  /** 字の並ぶ向きの終わり */
  readonly end: number;
  /** 行と交わる向きの位置 */
  readonly cross: number;
  /** 字の大きさ */
  readonly size: number;
}

/**
 * NFKC の形にする。1字が1字にならないとき（㍻ など）は、もとの字のままにする。
 * @param ch 1字
 * @returns 判定に使う形
 */
export function normalizeGlyph(ch: string): string {
  const norm = ch.normalize('NFKC');
  return Array.from(norm).length === 1 ? norm : ch;
}

/**
 * 印（marked content）ではなく、文字の片か。
 * @param item 片か印
 * @returns 文字の片なら true
 */
function isTextItem(item: PdfTextItem | PdfMarkedContent): item is PdfTextItem {
  return 'str' in item;
}

/**
 * 片の区間と位置。縦書きの片の x は列の中心、y は上の端。横書きの片の x は左の端、y は基準線。
 * @param item 片
 * @param isMarked 縦書きの印があるか
 * @returns 区間と位置
 */
function extentOf(item: PdfTextItem, isMarked: boolean): Extent {
  const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = item.transform;
  const size = Math.max(Math.hypot(a, b), Math.hypot(c, d));
  return isMarked
    ? { start: -y, end: -y + item.height, cross: x, size }
    : { start: x, end: x + item.width, cross: y, size };
}

/**
 * 片が、ほかの片と同じ字を同じ場所に重ねて描いたものか。
 * 白い縁取りや太字に見せる重ね描きでは、同じ片がもう1つあるか、片の一部だけがもう1つある。
 * 同じ向き・同じ大きさで、ほかの片の区間の中にあり、字がほかの片の字の一部なら、重ねて描いたものと見なす。
 * 同じ字の片が2つあるときは、先の片を残す。
 * @param piece 見る片
 * @param other ほかの片
 * @param isOtherFirst ほかの片が先にあるか
 * @returns 重ねて描いたものなら true
 */
function isOverdrawn(piece: Piece, other: Piece, isOtherFirst: boolean): boolean {
  const { extent } = piece;
  const otherExtent = other.extent;
  const size = Math.max(extent.size, otherExtent.size);
  const reach = size * OVERDRAWN_REACH_EM;
  return (
    piece.isMarked === other.isMarked &&
    size <= Math.min(extent.size, otherExtent.size) * OVERDRAWN_SIZE_RATIO &&
    Math.abs(extent.cross - otherExtent.cross) < size * OVERDRAWN_CROSS_EM &&
    extent.start >= otherExtent.start - reach &&
    extent.end <= otherExtent.end + reach &&
    (piece.text.length < other.text.length
      ? other.text.includes(piece.text)
      : isOtherFirst && other.text === piece.text)
  );
}

/**
 * 同じ字を同じ場所に重ねて描いた片を除く。除かないと、字が2回読まれ、ルビも2つ付く。
 * @param pieces 片の順の片
 * @returns 重ねて描いた片を除いた片（片の順）
 */
function withoutOverdrawn(pieces: readonly Piece[]): Piece[] {
  return pieces.filter(
    (piece, index) =>
      !pieces.some(
        (other, otherIndex) =>
          otherIndex !== index && isOverdrawn(piece, other, otherIndex < index),
      ),
  );
}

/**
 * 片の字を、向きに合わせて1字ずつの箱にする。空白は位置を数えるのに使い、字としては捨てる。
 * @param piece 片
 * @param isVertical 縦に並べるか（縦書きの印のある片だけ）
 * @param evidence 字に付ける向きの手がかり
 * @returns 位置つきの字
 */
function placeGlyphs(piece: Piece, isVertical: boolean, evidence: Evidence): PlacedGlyph[] {
  const [a = 0, b = 0, c = 0, d = 0, x = 0, y = 0] = piece.item.transform;
  const scaleX = Math.hypot(a, b);
  const scaleY = Math.hypot(c, d);
  const size = Math.max(scaleX, scaleY);
  const count = piece.chars.length;
  const slots = isVertical ? verticalSlots(piece.chars, piece.item.height, size) : [];
  const glyphs: PlacedGlyph[] = [];
  for (const [index, ch] of piece.chars.entries()) {
    if (SKIPPED_CHAR.test(ch)) continue;
    let rect: Rect;
    if (isVertical) {
      // 縦書きの片の x は列の中心、y は上の端
      const [start = 0, end = 0] = slots[index] ?? [];
      rect = {
        x1: x - scaleX / 2,
        x2: x + scaleX / 2,
        y1: y - end,
        y2: y - start,
      };
    } else {
      const pitch = piece.item.width / count;
      rect = {
        x1: x + index * pitch,
        x2: x + (index + 1) * pitch,
        y1: y - scaleY * DESCENT_EM,
        y2: y + scaleY * ASCENT_EM,
      };
    }
    glyphs.push({
      ch,
      norm: normalizeGlyph(ch),
      rect,
      size,
      evidence,
      fontName: piece.item.fontName,
    });
  }
  return glyphs;
}

/**
 * 縦書きの片の中で、それぞれの字が上の端からどこまでを占めるかを決める。
 * 字は1字ぶん（大きさ）ずつ取り、pdf.js が入れた半角の空白は、片の長さの残りを等しく分けあう。
 * 字詰めや字間の空き方が不ぞろいでも、空白を1字と数えて等分するより、本当の字の位置に近くなる。
 * 残りがない（字が大きさより詰まっている）か空白がないときは、字（空白を除く）で等分する。
 * @param chars 片のすべての字（空白を含む）
 * @param length 片の長さ（縦の長さ）
 * @param size 字の大きさ
 * @returns 字ごとの [上の端からの始まり, 終わり]
 */
export function verticalSlots(
  chars: readonly string[],
  length: number,
  size: number,
): (readonly [number, number])[] {
  const gaps = chars.filter((ch) => GAP_CHAR.test(ch)).length;
  const solids = chars.length - gaps;
  const rest = length - solids * size;
  const hasGapRoom = gaps > 0 && solids > 0 && rest >= 0;
  const solidLength = hasGapRoom ? size : length / Math.max(solids, 1);
  const gapLength = hasGapRoom ? rest / gaps : 0;
  const slots: (readonly [number, number])[] = [];
  let at = 0;
  for (const ch of chars) {
    const step = GAP_CHAR.test(ch) ? gapLength : solidLength;
    slots.push([at, at + step]);
    at += step;
  }
  return slots;
}

/**
 * 字を1つのランにまとめる。
 * @param glyphs 並ぶ順の字（1つ以上）
 * @param direction 字の並ぶ向き
 * @returns ラン
 */
export function toRun(glyphs: readonly PlacedGlyph[], direction: Direction): TextRun {
  return {
    glyphs,
    text: glyphs.map((glyph) => glyph.ch).join(''),
    rect: unionRect(glyphs.map((glyph) => glyph.rect)),
    size: Math.max(...glyphs.map((glyph) => glyph.size)),
    direction,
  };
}

/**
 * 1字だけの片 next が、1字だけの片 prev の真下に続くか。
 * @param prev 前の片の字
 * @param next 次の片の字
 * @returns 真下に続くなら true
 */
function continuesDown(prev: PlacedGlyph, next: PlacedGlyph): boolean {
  const size = Math.max(prev.size, next.size);
  const step = prev.rect.y1 - next.rect.y1;
  return (
    size <= Math.min(prev.size, next.size) * CHAIN_SIZE_RATIO &&
    Math.abs(centerX(prev.rect) - centerX(next.rect)) < size * CHAIN_AXIS_EM &&
    step >= size * CHAIN_STEP_MIN_EM &&
    step <= size * CHAIN_STEP_MAX_EM
  );
}

/**
 * 1字ずつの片の並びをランにする。十分に長く真下へ続けば縦書きの1つのラン、そうでなければ1字ずつのラン。
 * @param chain 片の順に続く、1字だけの片の字
 * @returns ラン
 */
function chainToRuns(chain: readonly PlacedGlyph[]): TextRun[] {
  if (chain.length >= MIN_CHAIN_LENGTH) {
    return [
      toRun(
        chain.map((glyph) => ({ ...glyph, evidence: 'chain' })),
        'vertical',
      ),
    ];
  }
  return chain.map((glyph) => toRun([glyph], 'horizontal'));
}

/**
 * pdf.js の文字の片を、位置つきの字のランにする。
 * 空白だけの片・印・回した横書きの片・同じ字を重ねて描いた片は捨てる。
 * 1字だけの片が真下へ続く並びは、縦書きの1つのランにする。
 * @param content getTextContent() の結果
 * @returns 片の順のラン
 */
export function toRuns(content: PdfTextContent): TextRun[] {
  const pieces: Piece[] = [];
  for (const item of content.items.filter(isTextItem)) {
    const chars = Array.from(item.str);
    const shown = chars.filter((ch) => !SKIPPED_CHAR.test(ch));
    const visible = shown.length;
    const isMarked = item.dir === TOP_TO_BOTTOM || content.styles[item.fontName]?.vertical === true;
    const isRotated = Math.abs(item.transform[1] ?? 0) > ROTATION_EPSILON;
    if (visible === 0 || (isRotated && !isMarked)) continue;
    pieces.push({
      item,
      isMarked,
      chars,
      visible,
      text: shown.join(''),
      extent: extentOf(item, isMarked),
    });
  }

  const runs: TextRun[] = [];
  let chain: PlacedGlyph[] = [];
  for (const piece of withoutOverdrawn(pieces)) {
    if (piece.isMarked || piece.visible > 1) {
      runs.push(...chainToRuns(chain));
      chain = [];
      runs.push(
        piece.isMarked
          ? toRun(placeGlyphs(piece, true, 'mark'), 'vertical')
          : toRun(placeGlyphs(piece, false, 'item'), 'horizontal'),
      );
      continue;
    }
    // 字が1つだけの片なので、この繰り返しは1回
    for (const glyph of placeGlyphs(piece, false, 'lone')) {
      const prev = chain.at(-1);
      if (prev !== undefined && !continuesDown(prev, glyph)) {
        runs.push(...chainToRuns(chain));
        chain = [];
      }
      chain.push(glyph);
    }
  }
  runs.push(...chainToRuns(chain));
  return runs;
}
