// かたまりを、利用者が決めた向きで組み直す。向きの推定（page-text.ts）は変えず、
// 同じページの文字の片から、かたまりの字だけを取り出して、決めた向きの行にまとめ直す。
import { orderParagraphs } from './blocks';
import { SURE_CONFIDENCE } from './direction';
import { type PlacedGlyph, toRun, toRuns } from './glyphs';
import { buildLines } from './lines';
import { toBlock } from './page-text';
import { isRubyBase, type RubyGroup, splitRuby } from './ruby';
import type { Direction, PdfTextContent, TextBlock } from './types';

/** かたまりを組み直す関数 */
export type BlockRebuilder = (block: TextBlock, direction: Direction) => TextBlock | undefined;

/**
 * 字を見分ける鍵（文字と箱が同じなら同じ字）。
 * @param glyph 字
 * @returns 鍵
 */
function keyOf(glyph: Pick<PlacedGlyph, 'ch' | 'rect'>): string {
  const { x1, y1, x2, y2 } = glyph.rect;
  return `${glyph.ch}:${String(x1)},${String(y1)},${String(x2)},${String(y2)}`;
}

/**
 * 1ページの文字の片から、かたまりを決めた向きで組み直す関数を作る。
 * 片をたどるのは1回だけなので、同じページの多くのかたまりを続けて組み直せる。
 * @param content そのページの getTextContent() の結果
 * @returns 組み直す関数
 */
export function createBlockRebuilder(content: PdfTextContent): BlockRebuilder {
  const { body, rubies } = splitRuby(toRuns(content));
  const bodyGlyphs = body.flatMap((run) => run.glyphs);
  return (block, direction) => {
    const wanted = new Set(block.glyphs.map(keyOf));
    const placed = bodyGlyphs.filter((glyph) => wanted.has(keyOf(glyph)));
    if (placed.length === 0) return undefined;
    // 1字ずつを決めた向きのランにして、その向きの列・行にまとめ直す
    const lines = orderParagraphs(buildLines(placed.map((glyph) => toRun([glyph], direction))));
    const rubyOf = new Map<PlacedGlyph, RubyGroup>();
    for (const glyph of placed) {
      const group = rubies.find((ruby) => isRubyBase(ruby, glyph));
      if (group !== undefined) rubyOf.set(glyph, group);
    }
    // 利用者が決めた向きなので、自信は確かなものにする
    return { ...toBlock(lines.flat(), rubyOf), direction, confidence: SURE_CONFIDENCE };
  };
}
