// テストで使う、字とかたまりの作り方。字の箱は1字ぶん（size × size）にする。
import type { Direction, Glyph, TextBlock } from '@/pdf/types';

/** 字の大きさ（決めないとき） */
export const SIZE = 10;

/**
 * 縦書きの列の字を作る。
 * @param text 字（上から順）
 * @param x 列の左の端
 * @param top 列の上の端
 * @param size 字の大きさ
 * @returns 字
 */
export function columnGlyphs(text: string, x: number, top: number, size = SIZE): Glyph[] {
  return Array.from(text, (ch, index) => ({
    ch,
    norm: ch,
    rect: { x1: x, x2: x + size, y1: top - (index + 1) * size, y2: top - index * size },
    size,
    hasRuby: false,
    fontName: 'f1',
  }));
}

/**
 * 横書きの行の字を作る。
 * @param text 字（左から順）
 * @param left 行の左の端
 * @param bottom 行の下の端
 * @param size 字の大きさ
 * @returns 字
 */
export function rowGlyphs(text: string, left: number, bottom: number, size = SIZE): Glyph[] {
  return Array.from(text, (ch, index) => ({
    ch,
    norm: ch,
    rect: { x1: left + index * size, x2: left + (index + 1) * size, y1: bottom, y2: bottom + size },
    size,
    hasRuby: false,
    fontName: 'f1',
  }));
}

/**
 * 字を1つのかたまりにする。
 * @param glyphs 読む順の字
 * @param direction 字の並ぶ向き
 * @returns かたまり
 */
export function blockOf(glyphs: readonly Glyph[], direction: Direction): TextBlock {
  return {
    text: glyphs.map((glyph) => glyph.ch).join(''),
    glyphs,
    glyphIndexOfChar: glyphs.flatMap((glyph, index) =>
      Array.from({ length: glyph.ch.length }, () => index),
    ),
    direction,
    confidence: 1,
    rubies: [],
    rect: {
      x1: Math.min(...glyphs.map((glyph) => glyph.rect.x1)),
      y1: Math.min(...glyphs.map((glyph) => glyph.rect.y1)),
      x2: Math.max(...glyphs.map((glyph) => glyph.rect.x2)),
      y2: Math.max(...glyphs.map((glyph) => glyph.rect.y2)),
    },
  };
}
