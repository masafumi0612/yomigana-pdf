// pdf.js が Canvas に描いた字の位置で、getTextContent() から出した字の箱を正確にする。
// getTextContent() の片は、片の頭と長さしか分からないので、字の箱は片を字の数で等分したものになる。
// 半角の数字や字詰めのある片では、等分した箱が本当の字から半字ほどずれるので、描いた位置に合わせる。
import { unionRect } from '@/pdf/rect';
import type { Glyph, Rect, TextBlock } from '@/pdf/types';

import { alongOf, crossOf, splitLines } from './block-lines';
import { applyMatrix, type Matrix, type Point } from './transform';

/** Canvas に描いた1字の位置（Canvas の画素） */
export interface DrawnGlyph {
  /** 字の基準線の左の端 */
  readonly origin: Point;
  /** 基準線の上を、字の送り幅だけ進んだ点 */
  readonly advance: Point;
  /** 基準線の左の端から、字の大きさ（1字ぶん）だけ上の点 */
  readonly top: Point;
}

/** PDF の座標にした、描いた1字 */
export interface DrawnBox {
  /** 字の箱 */
  readonly rect: Rect;
  /** 字の大きさ */
  readonly size: number;
}

/** 字の箱：基準線から下に 0.12 字、上に 0.88 字（getTextContent() からの箱と同じ決まり） */
const DESCENT_EM = 0.12;
const ASCENT_EM = 0.88;
/** 行の字と見なす、描いた字の、行と交わる向きのずれの上限（字） */
const LINE_BAND_EM = 0.35;
/** 行の字と見なす、描いた字が行の端からはみ出してよい長さ（字） */
const LINE_REACH_EM = 0.6;
/** 数が合わないときに、1字ごとに比べる描いた字の数 */
const LOOKAHEAD = 3;
/** 数が合わないときに、同じ字と見なす読む向きのずれの上限（字） */
const MAX_SHIFT_EM = 0.75;
/** 同じ字と見なす大きさの比の上限 */
const MAX_SIZE_RATIO = 1.4;

/**
 * 描いた字を、PDF の座標の箱にする。
 * @param draws 描いた字（Canvas の画素）
 * @param canvasToPdf Canvas の画素から PDF の座標への変換
 * @returns 描いた字の箱（PDF の座標）。大きさのない字は除く
 */
export function toDrawnBoxes(draws: readonly DrawnGlyph[], canvasToPdf: Matrix): DrawnBox[] {
  const boxes: DrawnBox[] = [];
  for (const draw of draws) {
    const origin = applyMatrix(canvasToPdf, draw.origin);
    const advance = applyMatrix(canvasToPdf, draw.advance);
    const top = applyMatrix(canvasToPdf, draw.top);
    const up = { x: top.x - origin.x, y: top.y - origin.y };
    const along = { x: advance.x - origin.x, y: advance.y - origin.y };
    const size = Math.hypot(up.x, up.y);
    if (size === 0) continue;
    const corners = [-DESCENT_EM, ASCENT_EM].flatMap((rise) =>
      [0, 1].map((step) => ({
        x: origin.x + along.x * step + up.x * rise,
        y: origin.y + along.y * step + up.y * rise,
      })),
    );
    boxes.push({
      rect: {
        x1: Math.min(...corners.map((corner) => corner.x)),
        y1: Math.min(...corners.map((corner) => corner.y)),
        x2: Math.max(...corners.map((corner) => corner.x)),
        y2: Math.max(...corners.map((corner) => corner.y)),
      },
      size,
    });
  }
  return boxes;
}

/**
 * かたまりの字を、描いた字に合わせる。行ごとに、行の帯に入る描いた字を読む順に並べ、
 * 数が合えば順に組にする。合わなければ（縦中横・記号など）、近い順に組にする。
 * @param blocks ページのかたまり
 * @param boxes 描いた字の箱（PDF の座標）
 * @returns 合わせられた字の、描いた箱。合わせられなかった字は入らない
 */
export function snapGlyphs(
  blocks: readonly TextBlock[],
  boxes: readonly DrawnBox[],
): Map<Glyph, Rect> {
  const snapped = new Map<Glyph, Rect>();
  const unused = new Set(boxes);
  for (const block of blocks) {
    for (const line of splitLines(block.glyphs, block.direction)) {
      const glyphs = line.flatMap((index) => block.glyphs[index] ?? []);
      const direction = block.direction;
      const size = Math.max(...glyphs.map((glyph) => glyph.size));
      const rect = unionRect(glyphs.map((glyph) => glyph.rect));
      const cross = crossOf({ rect }, direction);
      const first = Math.min(...glyphs.map((glyph) => alongOf(glyph, direction)));
      const last = Math.max(...glyphs.map((glyph) => alongOf(glyph, direction)));
      const candidates = [...unused]
        .filter((box) => {
          const along = alongOf(box, direction);
          return (
            Math.abs(crossOf(box, direction) - cross) < size * LINE_BAND_EM &&
            along > first - size * LINE_REACH_EM &&
            along < last + size * LINE_REACH_EM
          );
        })
        .sort((p, q) => alongOf(p, direction) - alongOf(q, direction));
      const pairs =
        candidates.length === glyphs.length
          ? glyphs.map((glyph, index) => [glyph, candidates[index]] as const)
          : pairNearest(glyphs, candidates, block);
      for (const [glyph, box] of pairs) {
        if (box === undefined || !isSameSize(glyph.size, box.size)) continue;
        snapped.set(glyph, box.rect);
        unused.delete(box);
      }
    }
  }
  return snapped;
}

/**
 * 行の字と描いた字を、読む順に進みながら近いものどうしで組にする。
 * @param glyphs 行の字（読む順）
 * @param candidates 行の帯に入る描いた字（読む順）
 * @param block 字のかたまり（向きを見る）
 * @returns 字と描いた字の組
 */
function pairNearest(
  glyphs: readonly Glyph[],
  candidates: readonly DrawnBox[],
  block: Pick<TextBlock, 'direction'>,
): (readonly [Glyph, DrawnBox])[] {
  const pairs: (readonly [Glyph, DrawnBox])[] = [];
  let next = 0;
  for (const glyph of glyphs) {
    const want = alongOf(glyph, block.direction);
    let best: number | undefined;
    let bestShift = glyph.size * MAX_SHIFT_EM;
    for (const [index, box] of candidates.slice(next, next + LOOKAHEAD).entries()) {
      const shift = Math.abs(alongOf(box, block.direction) - want);
      if (shift < bestShift) {
        best = next + index;
        bestShift = shift;
      }
    }
    const box = best === undefined ? undefined : candidates[best];
    if (best === undefined || box === undefined) continue;
    pairs.push([glyph, box]);
    next = best + 1;
  }
  return pairs;
}

/**
 * 2つの字の大きさが、同じ字と見なせるほど近いか。
 * @param p 1つめの大きさ
 * @param q 2つめの大きさ
 * @returns 近ければ true
 */
function isSameSize(p: number, q: number): boolean {
  return Math.max(p, q) <= Math.min(p, q) * MAX_SIZE_RATIO;
}
