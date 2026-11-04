// PDF の文を、kuromoji から字ごとの分割まで本物の処理に通して、
// 漢字を含む語のうち字ごとに分けられた割合を測る。
// - リポジトリのテスト用 PDF（test-pdfs/out）：いつも測る（CI でも動く）
// - 手元の教材の PDF：環境変数 YOMIGANA_LOCAL_PDF_DIR にフォルダを指定したときだけ測る。
//   例：YOMIGANA_LOCAL_PDF_DIR=C:/path/to/local-only npm run accuracy:local
//   リポジトリには入れられない PDF なので、CI では飛ばす。PDF の文そのものは出さず、
//   語の数と、字ごとに分けられなかった語だけを出す
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { IpadicFeatures, Tokenizer } from 'kuromoji';
import { builder } from 'kuromoji';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TestContext } from 'vitest';
import { beforeAll, describe, expect, it } from 'vitest';

import { extractPageText } from '@/pdf/page-text';
import { applyFixups } from '@/text/fixups';
import { normalizeForAnalysis } from '@/text/normalize';
import { splitReading } from '@/text/split';
import { toTokens } from '@/text/tokens';
import type { SplitResult } from '@/text/types';

import { EXPECTATIONS } from '../../../scripts/test-pdfs/expectations';

/**
 * リポジトリのテスト用 PDF での、字ごとに分けられた割合の下限。
 * テスト用 PDF は、付表の語・当て字・表外字など難しい語をわざと多く入れて書いてあるので、
 * ふつうの文より割合が低い（この線を入れたときは 92.26%）。そこで、この値は目標ではなく、
 * 処理を変えて割合が下がったことに気づくための床にする（測った値を 0.1 ポイント単位で切り捨てたもの）。
 * 処理を直して割合が上がったら、この値も上げる。
 * 本来の目標の線（LOCAL_MIN_SPLIT_RATE）は、作者の手元の教材の PDF で npm run accuracy:local を動かして確かめる
 */
const REPO_MIN_SPLIT_RATE = 0.922;
/**
 * 手元の教材の PDF での下限。読みを字ごとに分ける仕組みを作ったとき、
 * 本物の教材の PDF 3つ（漢字を含む語 3,935）で測った割合
 */
const LOCAL_MIN_SPLIT_RATE = 0.989;
/** 手元の教材の PDF を置いたフォルダ。リポジトリには入れない PDF なので、指定がなければ測らない */
const LOCAL_PDF_DIR = process.env.YOMIGANA_LOCAL_PDF_DIR;
/** 辞書を読み、PDF をすべて解析し終えるまでの時間の上限（ミリ秒）。手元ではテスト用 PDF で1秒ほど */
const ANALYZE_TIMEOUT_MS = 120_000;
const PERCENT = 100;

/** pdfjs-dist に入っている、文字の番号の対応表（CMap）のフォルダ。区切りの / で終える */
const CMAP_DIR = `${join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'cmaps')}/`;
const OUT_DIR = fileURLToPath(new URL('../../../test-pdfs/out/', import.meta.url));
/**
 * 測らない PDF。Word の縦書きは、横書きの版（word/word-horizontal）と同じ文なので、同じ語を2度数えないようにする
 * （縦書きとして読めることは tests/unit/pdf で確かめる）
 */
const SKIPPED = new Set(['word/word-vertical']);

/** 1つの PDF の、漢字を含む語の数え方 */
interface Tally {
  /** フォルダからの名前（.pdf を除く） */
  readonly name: string;
  /** 漢字を含む語の数 */
  readonly words: number;
  /** そのうち字ごとに分けられなかった語 */
  readonly blocks: readonly SplitResult[];
}

/** いくつかの PDF をまとめた結果 */
interface Summary {
  /** 字ごとに分けられた割合（0〜1） */
  readonly rate: number;
  /** 割合・PDF ごとの数・分けられなかった語を並べた文 */
  readonly report: string;
}

let tokenizerPromise: Promise<Tokenizer<IpadicFeatures>> | undefined;

/**
 * フォルダの中の PDF の名前を挙げる（下のフォルダも見る）。
 * @param dir 探すフォルダ
 * @returns フォルダからの名前（.pdf を除き、区切りは /）
 */
function listPdfNames(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.pdf'))
    .map((entry) =>
      relative(dir, join(entry.parentPath, entry.name))
        .replaceAll('\\', '/')
        .replace(/\.pdf$/u, ''),
    )
    .toSorted();
}

/**
 * テスト用 PDF のうち、文として測るものを挙げる。
 * 決めたこと（expectations.ts）のないもの・画像だけのもの・同じ文の版は除く。
 * @returns test-pdfs/out からの名前（.pdf を除く）
 */
function listRepoPdfNames(): string[] {
  return listPdfNames(OUT_DIR).filter((name) => {
    const expectation = EXPECTATIONS[name];
    return expectation !== undefined && expectation.noText !== true && !SKIPPED.has(name);
  });
}

/**
 * PDF の文を pdf.js で取り出し、読む順のかたまりの文にする（もとからあるルビは除く）。
 * @param path PDF のパス
 * @returns かたまりごとの文
 */
async function readBlockTexts(path: string): Promise<string[]> {
  const data = new Uint8Array(readFileSync(path));
  // 日本語の PDF には、文字の番号の対応表（CMap）が要るものがある。pdfjs-dist に入っている表を使う
  const task = getDocument({ data, useSystemFonts: false, cMapUrl: CMAP_DIR, cMapPacked: true });
  const doc = await task.promise;
  const texts: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    for (const block of extractPageText(content).blocks) texts.push(block.text);
  }
  await task.destroy();
  return texts;
}

/**
 * kuromoji の辞書を、入れた kuromoji の中から読む（1度だけ読み、あとは同じものを使う）。
 * @returns kuromoji の解析器
 */
async function loadTokenizer(): Promise<Tokenizer<IpadicFeatures>> {
  tokenizerPromise ??= new Promise((resolve, reject) => {
    const require = createRequire(import.meta.url);
    const dicPath = join(dirname(require.resolve('kuromoji/package.json')), 'dict');
    // 型では error がいつもあることになっているが、うまく読めたときは null が来る
    builder({ dicPath }).build((error: Error | null, tokenizer) => {
      if (error === null) resolve(tokenizer);
      else reject(error);
    });
  });
  return tokenizerPromise;
}

/**
 * 文を、正規化 → kuromoji → 読みの手直し → 字ごとの分割 の順に通す。
 * @param tokenizer kuromoji の解析器
 * @param text もとの文
 * @returns 語ごとの、字ごとに分けた結果
 */
function analyze(tokenizer: Tokenizer<IpadicFeatures>, text: string): SplitResult[] {
  const tokens = toTokens(tokenizer.tokenize(normalizeForAnalysis(text).text));
  return applyFixups(tokens, new Map()).map(splitReading);
}

/**
 * フォルダの中の PDF の語を、PDF ごとに数える。
 * @param dir PDF のフォルダ
 * @param names フォルダからの名前（.pdf を除く）
 * @returns PDF ごとの、漢字を含む語の数と、字ごとに分けられなかった語
 */
async function tallyPdfs(dir: string, names: readonly string[]): Promise<Tally[]> {
  const tokenizer = await loadTokenizer();
  return Promise.all(
    names.map(async (name) => {
      const texts = await readBlockTexts(join(dir, `${name}.pdf`));
      const results = texts.flatMap((text) => analyze(tokenizer, text));
      // 漢字のない語は、仮名の1つ分だけになる
      const withKanji = results.filter((result) => result.segs.some((seg) => seg.kind !== 'kana'));
      return {
        name,
        words: withKanji.length,
        blocks: withKanji.filter((result) => result.segs.some((seg) => seg.kind === 'block')),
      };
    }),
  );
}

/**
 * 字ごとに分けられなかった語を、読みやすい1行にする（理由と、語/読み）。
 * @param result 字ごとに分けた結果
 * @returns 1行の説明
 */
function describeBlock(result: SplitResult): string {
  const why = result.segs.map((seg) => (seg.kind === 'block' ? seg.why : '')).find(Boolean);
  return `${why ?? ''} ${result.word.surface}/${result.word.reading}`;
}

/**
 * PDF ごとの数をまとめて、割合と、読みやすい報告にする。
 * @param tallies PDF ごとの数
 * @returns 割合と報告
 */
function summarize(tallies: readonly Tally[]): Summary {
  const words = tallies.reduce((sum, tally) => sum + tally.words, 0);
  const blocks = tallies.flatMap((tally) => tally.blocks);
  const rate = words === 0 ? 0 : (words - blocks.length) / words;
  const report = [
    `字ごとに分けられた割合 ${(rate * PERCENT).toFixed(2)}%（漢字を含む語 ${String(words)}）`,
    ...tallies.map(
      (tally) =>
        `  ${tally.name}: ${String(tally.words - tally.blocks.length)}/${String(tally.words)}`,
    ),
    '字ごとに分けられなかった語:',
    ...blocks.map((block) => `  ${describeBlock(block)}`),
  ].join('\n');
  return { rate, report };
}

/**
 * 割合が下限以上かを確かめ、結果をテストの報告に残す。
 * @param context テストの情報（報告を残すため）
 * @param summary まとめた結果
 * @param min 下限（0〜1）
 */
async function expectRateAtLeast(
  context: TestContext,
  summary: Summary,
  min: number,
): Promise<void> {
  await context.annotate(summary.report);
  expect(summary.rate, summary.report).toBeGreaterThanOrEqual(min);
}

describe('リポジトリのテスト用 PDF の語での読みの精度', () => {
  let tallies: Tally[] = [];

  beforeAll(async () => {
    tallies = await tallyPdfs(OUT_DIR, listRepoPdfNames());
  }, ANALYZE_TIMEOUT_MS);

  it('測る PDF があり、どれにも漢字を含む語がある', () => {
    expect(tallies.length).toBeGreaterThan(0);
    for (const tally of tallies) expect(tally.words, tally.name).toBeGreaterThan(0);
  });

  it(`漢字を含む語の ${String(REPO_MIN_SPLIT_RATE * PERCENT)}% 以上を字ごとに分けられる`, async (context) => {
    await expectRateAtLeast(context, summarize(tallies), REPO_MIN_SPLIT_RATE);
  });
});

describe.skipIf(LOCAL_PDF_DIR === undefined)('手元の教材の PDF の語での読みの精度', () => {
  it(
    `漢字を含む語の ${String(LOCAL_MIN_SPLIT_RATE * PERCENT)}% 以上を字ごとに分けられる`,
    async (context) => {
      const dir = LOCAL_PDF_DIR ?? '';
      const tallies = await tallyPdfs(dir, listPdfNames(dir));
      await expectRateAtLeast(context, summarize(tallies), LOCAL_MIN_SPLIT_RATE);
    },
    ANALYZE_TIMEOUT_MS,
  );
});
