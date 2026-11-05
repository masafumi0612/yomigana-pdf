// pdf.js の getTextContent() の結果から、読みの処理に渡す文を組み立てる。
// 片 → 字と位置 → もとからあるルビを分ける → 行 → 段落（読む順）→ 文と、文の各字が当たる字の対応。
// ルビを除いてから行をつなぐので、改行やルビで語が途中で切れない。
import { orderParagraphs } from './blocks';
import type { PlacedGlyph } from './glyphs';
import { toRuns } from './glyphs';
import { buildLines, type TextLine } from './lines';
import { unionRect } from './rect';
import { isRubyBase, type RubyGroup, splitRuby } from './ruby';
import type { Direction, ExistingRuby, Glyph, PageText, PdfTextContent, TextBlock } from './types';

/** 縦書きの印や、横に並ぶ字の片から向きが分かるかたまりの自信 */
const CONFIDENCE_MARKED = 1;
/** 1字ずつの片の並びから向きを推定したかたまりの自信 */
const CONFIDENCE_ESTIMATED = 0.8;
/** 1字だけで、向きの手がかりのないかたまりの自信 */
const CONFIDENCE_SINGLE = 0.5;

/**
 * かたまりの向きの自信。向きを示す字（縦書きは縦書きの印のある字、横書きは2字以上の片の字）があれば 1、
 * なければ1字ずつの片の並びからの推定なので低くする。
 * @param glyphs かたまりの字（1つ以上）
 * @param direction かたまりの向き
 * @returns 0〜1
 */
function confidenceOf(glyphs: readonly PlacedGlyph[], direction: Direction): number {
  const sure = direction === 'vertical' ? 'mark' : 'item';
  if (glyphs.some((glyph) => glyph.evidence === sure)) return CONFIDENCE_MARKED;
  return glyphs.length > 1 ? CONFIDENCE_ESTIMATED : CONFIDENCE_SINGLE;
}

/**
 * かたまりの中の、もとからあるルビを挙げる。
 * @param glyphs かたまりの字
 * @param rubyOf 字ごとの、親字になっているルビ
 * @returns もとからあるルビ（親字の位置の順）
 */
function rubiesIn(
  glyphs: readonly PlacedGlyph[],
  rubyOf: ReadonlyMap<PlacedGlyph, RubyGroup>,
): ExistingRuby[] {
  const ranges: { start: number; end: number; group: RubyGroup }[] = [];
  for (const [index, glyph] of glyphs.entries()) {
    const group = rubyOf.get(glyph);
    if (group === undefined) continue;
    const last = ranges.at(-1);
    if (last?.group === group && last.end === index) last.end = index + 1;
    else ranges.push({ start: index, end: index + 1, group });
  }
  return ranges.map(({ start, end, group }) => ({ start, end, reading: group.reading }));
}

/**
 * 段落の行をつないで、1つのかたまりにする。
 * @param lines 段落の行（1つ以上、同じ向き）
 * @param rubyOf 字ごとの、親字になっているルビ
 * @returns かたまり
 */
export function toBlock(
  lines: readonly TextLine[],
  rubyOf: ReadonlyMap<PlacedGlyph, RubyGroup>,
): TextBlock {
  const placed = lines.flatMap((line) => line.glyphs);
  const glyphs: Glyph[] = placed.map((glyph) => ({
    ch: glyph.ch,
    norm: glyph.norm,
    rect: glyph.rect,
    size: glyph.size,
    hasRuby: rubyOf.has(glyph),
    fontName: glyph.fontName,
  }));
  const glyphIndexOfChar = glyphs.flatMap((glyph, index) =>
    Array.from({ length: glyph.ch.length }, () => index),
  );
  const direction = lines[0]?.direction ?? 'horizontal';
  return {
    text: glyphs.map((glyph) => glyph.ch).join(''),
    glyphs,
    glyphIndexOfChar,
    direction,
    confidence: confidenceOf(placed, direction),
    rubies: rubiesIn(placed, rubyOf),
    rect: unionRect(lines.map((line) => line.rect)),
  };
}

/**
 * 1ページの文字の片から、読む順のかたまりの文を組み立てる。
 * もとからあるルビは本文から除き、その親字の読みとして持つ。
 * @param content pdf.js の getTextContent() の結果
 * @returns 読む順のかたまり
 */
export function extractPageText(content: PdfTextContent): PageText {
  const { body, rubies } = splitRuby(toRuns(content));
  const lines = buildLines(body);
  const rubyOf = new Map<PlacedGlyph, RubyGroup>();
  for (const glyph of lines.flatMap((line) => line.glyphs)) {
    const group = rubies.find((ruby) => isRubyBase(ruby, glyph));
    if (group !== undefined) rubyOf.set(glyph, group);
  }
  return {
    blocks: orderParagraphs(lines).map((paragraph) => toBlock(paragraph, rubyOf)),
    styles: content.styles,
  };
}
