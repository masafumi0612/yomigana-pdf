import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { extractPageText } from '@/pdf/page-text';
import type { TextBlock } from '@/pdf/types';

import { EXPECTATIONS } from '../../../scripts/test-pdfs/expectations';
import {
  contentOf,
  defined,
  horizontalItem,
  SIZE,
  unmarkedColumn,
  verticalItem,
} from './make-items';

/** 親字の大きさ */
const BASE = 20;
/** ルビの字の大きさ */
const RUBY = 10;
/** pdfjs-dist に入っている、文字の番号の対応表（CMap）のフォルダ。区切りの / で終える */
const CMAP_DIR = `${join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'cmaps')}/`;
const OUT_DIR = fileURLToPath(new URL('../../../test-pdfs/out/', import.meta.url));
/** PDF をすべて読み終えるまでの時間の上限（ミリ秒） */
const READ_TIMEOUT_MS = 60_000;

/**
 * テスト用 PDF を pdf.js で読み、すべてのページのかたまりを読む順に並べる。
 * @param name test-pdfs/out からの名前（.pdf を除く）
 * @returns かたまり
 */
async function readBlocks(name: string): Promise<TextBlock[]> {
  const data = new Uint8Array(readFileSync(join(OUT_DIR, `${name}.pdf`)));
  const task = getDocument({ data, useSystemFonts: false, cMapUrl: CMAP_DIR, cMapPacked: true });
  const doc = await task.promise;
  const blocks: TextBlock[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    blocks.push(...extractPageText(await page.getTextContent()).blocks);
  }
  await task.destroy();
  return blocks;
}

/**
 * かたまりの文を、判定に使う形（NFKC）でつなぐ。
 * @param blocks かたまり
 * @returns 1行に1つのかたまりの文
 */
function normTextOf(blocks: readonly TextBlock[]): string {
  return blocks.map((block) => block.glyphs.map((glyph) => glyph.norm).join('')).join('\n');
}

/**
 * 見つからない言葉を挙げる。
 * @param text 探す文
 * @param words 言葉
 * @returns 見つからない言葉
 */
function missingWords(text: string, words: readonly string[] | undefined): string[] {
  return (words ?? []).filter((word) => !text.includes(word.normalize('NFKC')));
}

describe('extractPageText（手で作った片）', () => {
  const rubyLine = 500 + BASE * 0.88 + RUBY * 0.12;
  const { blocks } = extractPageText(
    contentOf([
      horizontalItem('星の地球を大', 100, 500, BASE),
      horizontalItem('ちきゅう', 140, rubyLine, RUBY),
      horizontalItem('たい', 200, rubyLine, RUBY),
      horizontalItem('切にする。', 100, 465, BASE),
    ]),
  );
  const block = defined(blocks[0]);

  it('もとからあるルビを除いて、行をつないだ文になる', () => {
    expect(blocks.map((b) => b.text)).toEqual(['星の地球を大切にする。']);
  });

  it('もとからあるルビを、親字の位置と読みで持つ', () => {
    expect(block.rubies).toEqual([
      { start: 2, end: 4, reading: 'ちきゅう' },
      { start: 5, end: 6, reading: 'たい' },
    ]);
  });

  it('もとからあるルビの親字に、ルビがある印が付く', () => {
    expect(block.glyphs.filter((glyph) => glyph.hasRuby).map((glyph) => glyph.ch)).toEqual([
      '地',
      '球',
      '大',
    ]);
  });

  it('横書きの片から組み立てたかたまりのとき、向きは横書きで自信は 1 になる', () => {
    expect([block.direction, block.confidence]).toEqual(['horizontal', 1]);
  });

  it('かたまりの箱が、すべての行を囲む', () => {
    expect(block.rect).toEqual({ x1: 100, x2: 220, y1: 465 - BASE * 0.12, y2: 500 + BASE * 0.88 });
  });

  it('UTF-16 で2単位の字のとき、文の2単位がどちらも同じ字に当たる', () => {
    const [only] = extractPageText(contentOf([horizontalItem('𠮷野家', 100, 500)])).blocks;
    expect(only?.glyphIndexOfChar).toEqual([0, 0, 1, 2]);
  });

  it('縦書きの印のある片のとき、向きは縦書きで自信は 1 になる', () => {
    const [only] = extractPageText(contentOf([verticalItem('今日は', 100, 500)])).blocks;
    expect([only?.direction, only?.confidence]).toEqual(['vertical', 1]);
  });

  it('縦書きの印のない1字ずつの片が真下へ続くとき、向きは縦書きで自信は 1 より低い', () => {
    const [only] = extractPageText(contentOf(unmarkedColumn('今日は', 100, 500))).blocks;
    expect([only?.direction, only?.confidence]).toEqual(['vertical', 0.8]);
  });

  it('1字だけで向きの手がかりのない片のとき、自信は低い', () => {
    const [only] = extractPageText(contentOf([horizontalItem('橋', 100, 500, SIZE)])).blocks;
    expect(only?.confidence).toBe(0.5);
  });

  it('文字のないページのとき、かたまりがない', () => {
    expect(extractPageText(contentOf([])).blocks).toEqual([]);
  });
});

describe('extractPageText（リポジトリのテスト用 PDF）', () => {
  const names = Object.keys(EXPECTATIONS);
  const blocksOf = new Map<string, TextBlock[]>();

  beforeAll(async () => {
    for (const name of names) blocksOf.set(name, await readBlocks(name));
  }, READ_TIMEOUT_MS);

  const withText = names.filter((name) => EXPECTATIONS[name]?.noText !== true);

  it.each(withText)('%s のとき、決めた言葉が読む順の文に出てくる', (name) => {
    const blocks = blocksOf.get(name) ?? [];
    const expectation = defined(EXPECTATIONS[name]);
    const vertical = blocks.filter((block) => block.direction === 'vertical');
    const horizontal = blocks.filter((block) => block.direction === 'horizontal');
    expect([
      ...missingWords(normTextOf(blocks), expectation.words),
      ...missingWords(normTextOf(vertical), expectation.verticalWords),
      ...missingWords(normTextOf(horizontal), expectation.horizontalWords),
    ]).toEqual([]);
  });

  it('もとからあるルビの PDF のとき、ルビのある字だけに印が付く', () => {
    const glyphs = (blocksOf.get('existing-ruby') ?? []).flatMap((block) => block.glyphs);
    const marked = new Set(glyphs.filter((glyph) => glyph.hasRuby).map((glyph) => glyph.norm));
    const unmarked = new Set(glyphs.filter((glyph) => !glyph.hasRuby).map((glyph) => glyph.norm));
    const expectation = defined(EXPECTATIONS['existing-ruby']);
    expect(Array.from(expectation.rubyOn ?? '').filter((ch) => !marked.has(ch))).toEqual([]);
    expect(
      Array.from(expectation.noRubyOn ?? '').filter((ch) => marked.has(ch) && !unmarked.has(ch)),
    ).toEqual([]);
  });

  it('もとからあるルビの PDF のとき、ルビの読みを親字ごとに持つ', () => {
    const block = defined(
      (blocksOf.get('existing-ruby') ?? []).find((b) => b.text.startsWith('私は夏休み')),
    );
    expect(
      block.rubies.map((ruby) => `${block.text.slice(ruby.start, ruby.end)}:${ruby.reading}`),
    ).toEqual(['私:わたし', '夏休:なつやす', '港:みなと', '博物館:はくぶつかん', '行:い']);
  });

  it('縦書きの物語の PDF のとき、どのかたまりも縦書きの印から縦書きと分かる', () => {
    const blocks = (blocksOf.get('vertical-story') ?? []).filter((b) => b.glyphs.length > 3);
    expect(blocks.every((b) => b.direction === 'vertical' && b.confidence === 1)).toBe(true);
  });

  it('Word の縦書きの PDF のとき、縦書きの印がなくても縦書きと推定する', () => {
    const blocks = blocksOf.get('word/word-vertical') ?? [];
    expect(blocks.map((b) => [b.direction, b.confidence])).toEqual(
      blocks.map(() => ['vertical', 0.8]),
    );
  });

  it('Word の縦書きの PDF のとき、右の列から読む', () => {
    const text = normTextOf(blocksOf.get('word/word-vertical') ?? []);
    expect(text.indexOf('今日は朝から')).toBeLessThan(text.indexOf('少年は窓辺に'));
  });

  it('縦書きの段が2つある紙面のとき、上の段を読んでから下の段を読む', () => {
    const text = normTextOf(blocksOf.get('mixed-layout') ?? []);
    const order = ['川の生き物を調べたよ', 'メダカのむれ', 'わかったこと', '次は、雨の後に'];
    const positions = order.map((word) => text.indexOf(word));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions.toSorted((p, q) => p - q)).toEqual(positions);
  });

  it('横書きと縦書きの混じったプリントのとき、横書きの表は横書きのかたまりになる', () => {
    const blocks = blocksOf.get('mixed-direction') ?? [];
    const table = blocks.find((block) => block.text.includes('ことばのいみを調べる本'));
    expect(table?.direction).toBe('horizontal');
  });

  it('画像だけの PDF のとき、かたまりがない', () => {
    expect(blocksOf.get('scanned-like')).toEqual([]);
  });
});
