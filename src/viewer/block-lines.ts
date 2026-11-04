// かたまりの字（読む順）を、行（縦書きの列・横書きの行）ごとに分け直す。
// かたまりは行をつないだ文なので、字の位置が行の向きと交わる向きに大きく動いた所で区切る。
import { centerX, centerY } from '@/pdf/rect';
import type { Direction, Glyph } from '@/pdf/types';

/** 次の行に移ったと見なす、行と交わる向きの中心のずれ（字）。縦中横の数字（半字ずつ並ぶ）では区切らない */
const LINE_BREAK_CROSS_EM = 0.6;
/** 次の行に移ったと見なす、読む向きに戻る長さ（字） */
const LINE_BREAK_BACK_EM = 0.6;

/**
 * 字の、行に沿う向きの位置。読む向きに進むほど大きい。
 * @param glyph 字
 * @param direction 字の並ぶ向き
 * @returns 縦書きは下へ、横書きは右へ進むほど大きい値
 */
export function alongOf(glyph: Pick<Glyph, 'rect'>, direction: Direction): number {
  return direction === 'vertical' ? -centerY(glyph.rect) : centerX(glyph.rect);
}

/**
 * 字の、行と交わる向きの位置。
 * @param glyph 字
 * @param direction 字の並ぶ向き
 * @returns 縦書きは列の横の中心、横書きは行の縦の中心
 */
export function crossOf(glyph: Pick<Glyph, 'rect'>, direction: Direction): number {
  return direction === 'vertical' ? centerX(glyph.rect) : centerY(glyph.rect);
}

/**
 * かたまりの字を行ごとに分ける。
 * @param glyphs かたまりの字（読む順）
 * @param direction かたまりの向き
 * @returns 行ごとの、字の位置（glyphs の番号）の並び。字がなければ空
 */
export function splitLines(glyphs: readonly Glyph[], direction: Direction): number[][] {
  const lines: number[][] = [];
  let line: LineState | undefined;
  for (const [index, glyph] of glyphs.entries()) {
    if (line === undefined || isLineBreak(line, glyph, direction)) {
      line = { indexes: [index], cross: crossOf(glyph, direction), size: glyph.size, last: glyph };
      lines.push(line.indexes);
    } else {
      line.indexes.push(index);
      line.size = Math.max(line.size, glyph.size);
      line.last = glyph;
    }
  }
  return lines;
}

/** 分けている途中の行 */
interface LineState {
  readonly indexes: number[];
  /** 行の頭の字の、行と交わる向きの位置 */
  readonly cross: number;
  /** 行の中でいちばん大きい字の大きさ */
  size: number;
  /** 行の最後の字 */
  last: Glyph;
}

/**
 * 次の字で行が変わるか。行と交わる向きは行の頭の字と比べ、縦中横のように小さい字が並んでも区切らない。
 * @param line 分けている途中の行
 * @param next 次の字
 * @param direction 字の並ぶ向き
 * @returns 行が変わるなら true
 */
function isLineBreak(line: LineState, next: Glyph, direction: Direction): boolean {
  const size = Math.max(line.size, next.size);
  const cross = Math.abs(crossOf(next, direction) - line.cross);
  const back = alongOf(line.last, direction) - alongOf(next, direction);
  return cross > size * LINE_BREAK_CROSS_EM || back > size * LINE_BREAK_BACK_EM;
}
