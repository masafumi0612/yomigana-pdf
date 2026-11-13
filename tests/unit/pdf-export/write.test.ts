import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  openRubyPdf,
  type RubyFonts,
  type RubyGlyphBox,
  type RubyPageInput,
} from '@/pdf-export/write';
import type { PageFrame } from '@/viewer/ruby-layout';

import { buildEncryptedPdf } from '../../e2e/encrypted-pdf';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** pdfjs-dist に入っている CMap のフォルダ。区切りの / で終える */
const CMAP_DIR = `${join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'cmaps')}/`;
/** 見本の PDF（縦書き） */
const SOURCE = new Uint8Array(readFileSync(join(ROOT, 'test-pdfs/out/vertical-story.pdf')));
/** ルビのフォント */
const FONTS: RubyFonts = {
  serif: new Uint8Array(readFileSync(join(ROOT, 'src/assets/fonts/ruby-serif.woff2'))),
  sans: new Uint8Array(readFileSync(join(ROOT, 'src/assets/fonts/ruby-sans.woff2'))),
};
const STYLE = { color: '#1d4ed8', hasBand: false };
/** 字の大きさ */
const SIZE = 8;
/** 同じ字のルビを置く数（字の形を使い回すことを確かめる） */
const REPEAT = 200;
/** ルビ1つ（3字）を置くたびに増えてよい大きさ（バイト）。字の形をそのたびに入れると 1 KB を超える */
const BYTES_PER_REPEAT = 120;
/** PDF を読み直すのにかかる時間の上限（ミリ秒） */
const READ_TIMEOUT_MS = 60_000;

/** pdf.js で読んだ、1ページの文と大きさ */
interface PageDump {
  readonly text: string;
  readonly view: readonly number[];
  readonly rotate: number;
}

/**
 * PDF を pdf.js で読み、ページごとの文と大きさを取り出す。
 * @param data PDF
 * @returns ページごとの文と大きさ
 */
async function dump(data: Uint8Array): Promise<PageDump[]> {
  const task = getDocument({
    data: data.slice(),
    useSystemFonts: false,
    cMapUrl: CMAP_DIR,
    cMapPacked: true,
  });
  const document = await task.promise;
  const pages: PageDump[] = [];
  for (let number = 1; number <= document.numPages; number++) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('');
    pages.push({ text, view: page.view, rotate: page.rotate });
  }
  await task.destroy();
  return pages;
}

/**
 * PDF の中の Form XObject の数を数える。
 * @param data PDF
 * @returns Form XObject の数
 */
async function formCountOf(data: Uint8Array): Promise<number> {
  const document = await PDFDocument.load(data);
  return document.context
    .enumerateIndirectObjects()
    .filter(
      ([, object]) =>
        object instanceof PDFRawStream &&
        object.dict.get(PDFName.of('Subtype')) === PDFName.of('Form'),
    ).length;
}

/**
 * ルビを作る。
 * @param ruby ルビの文字
 * @param left 左の端
 * @param top 上の端
 * @param isVertical 縦書きなら true
 * @returns ルビ
 */
function boxOf(ruby: string, left: number, top: number, isVertical: boolean): RubyGlyphBox {
  const length = SIZE * ruby.length;
  return {
    ruby,
    isVertical,
    isSpread: false,
    isSerif: true,
    left,
    top,
    width: isVertical ? SIZE : length,
    height: isVertical ? length : SIZE,
    fontSize: SIZE,
  };
}

/**
 * 1ページめにルビを書き込む。
 * @param source もとの PDF
 * @param boxes 置くルビ
 * @param style ルビの見た目
 * @returns 新しい PDF
 */
async function write(
  source: Uint8Array,
  boxes: readonly RubyGlyphBox[],
  style = STYLE,
): Promise<Uint8Array> {
  const opened = await openRubyPdf(source, style, FONTS);
  if (!opened.ok) throw new Error(opened.error);
  const [page] = await dump(source);
  const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = page?.view ?? [];
  const frame: PageFrame = { pageX: x1, pageY: y1, pageWidth: x2 - x1, pageHeight: y2 - y1 };
  const input: RubyPageInput = { pageIndex: 0, frame, boxes };
  opened.value.addPage(input);
  return opened.value.save();
}

describe('openRubyPdf', () => {
  let source: PageDump[];
  let written: Uint8Array;
  let result: PageDump[];

  beforeAll(async () => {
    source = await dump(SOURCE);
    written = await write(SOURCE, [
      boxOf('きょう', 100, 100, true),
      boxOf('がっこう', 120, 100, true),
      boxOf('ラーメン', 100, 200, false),
    ]);
    result = await dump(written);
  }, READ_TIMEOUT_MS);

  it('ルビを書き込んだとき、ページの文はもとの PDF と同じ（ルビが文として入らない）', () => {
    expect(result.map((page) => page.text)).toEqual(source.map((page) => page.text));
  });

  it('ルビを書き込んだとき、ページの数・大きさ・向きはもとの PDF と同じ', () => {
    expect(result.map(({ view, rotate }) => ({ view, rotate }))).toEqual(
      source.map(({ view, rotate }) => ({ view, rotate })),
    );
  });

  it('ルビを書き込んだとき、PDF は大きくなる（字の形が入る）', () => {
    expect(written.length).toBeGreaterThan(SOURCE.length);
  });

  it('同じ字のルビをたくさん置いたとき、字の形を使い回して大きさを抑える', async () => {
    const once = await write(SOURCE, [boxOf('きょう', 100, 100, true)]);
    const many = await write(
      SOURCE,
      Array.from({ length: REPEAT }, (_, index) =>
        boxOf('きょう', 100 + (index % 20) * 10, 100, true),
      ),
    );

    expect((many.length - once.length) / (REPEAT - 1)).toBeLessThan(BYTES_PER_REPEAT);
  });

  it('縦書きの字形のない字のとき、縦書きと横書きで同じ字の形を使い回す', async () => {
    const written = await write(SOURCE, [
      boxOf('か', 100, 100, true),
      boxOf('か', 100, 200, false),
    ]);

    expect((await formCountOf(written)) - (await formCountOf(SOURCE))).toBe(1);
  });

  it('縦書きの字形のある字（小さい仮名）のとき、縦書きは縦書きの字形で描く', async () => {
    const written = await write(SOURCE, [
      boxOf('ょ', 100, 100, true),
      boxOf('ょ', 100, 200, false),
    ]);

    expect((await formCountOf(written)) - (await formCountOf(SOURCE))).toBe(2);
  });

  it('帯を敷くとき、帯のない PDF より大きくなり、ページの文は変わらない', async () => {
    const banded = await write(SOURCE, [boxOf('きょう', 100, 100, true)], {
      ...STYLE,
      hasBand: true,
    });
    const plain = await write(SOURCE, [boxOf('きょう', 100, 100, true)]);

    expect([banded.length > plain.length, (await dump(banded))[0]?.text]).toEqual([
      true,
      source[0]?.text,
    ]);
  });

  it('ルビのないページのとき、ページを変えない', async () => {
    const opened = await openRubyPdf(SOURCE, STYLE, FONTS);
    if (!opened.ok) throw new Error(opened.error);
    opened.value.addPage({
      pageIndex: 0,
      frame: { pageX: 0, pageY: 0, pageWidth: 1, pageHeight: 1 },
      boxes: [],
    });

    expect((await dump(await opened.value.save()))[0]?.text).toBe(source[0]?.text);
  });

  it('題名を渡して保存したとき、PDF の題名（/Title）になり、標準の表示のタブにも題名を出す', async () => {
    const opened = await openRubyPdf(SOURCE, STYLE, FONTS);
    if (!opened.ok) throw new Error(opened.error);
    const saved = await PDFDocument.load(await opened.value.save('物語（ルビ付き）'));
    const preferences = saved.catalog.lookup(PDFName.of('ViewerPreferences'));

    expect([saved.getTitle(), preferences?.toString().includes('/DisplayDocTitle true')]).toEqual([
      '物語（ルビ付き）',
      true,
    ]);
  });

  it('題名を渡さずに保存したとき、PDF の題名はもとのまま', async () => {
    const opened = await openRubyPdf(SOURCE, STYLE, FONTS);
    if (!opened.ok) throw new Error(opened.error);
    const saved = await PDFDocument.load(await opened.value.save());

    expect(saved.getTitle()).toBe((await PDFDocument.load(SOURCE)).getTitle());
  });

  it('ルビの座標からページの座標への変換を渡したとき、その変換の中でルビを書く', async () => {
    const opened = await openRubyPdf(SOURCE, STYLE, FONTS);
    if (!opened.ok) throw new Error(opened.error);
    opened.value.addPage({
      pageIndex: 0,
      frame: { pageX: 0, pageY: 0, pageWidth: 595, pageHeight: 842 },
      toPage: [0, 1, -1, 0, 600, 0],
      boxes: [boxOf('かさ', 100, 100, false)],
    });
    const saved = await opened.value.save();
    const document = await getDocument({
      data: saved,
      cMapUrl: CMAP_DIR,
      cMapPacked: true,
      verbosity: 0,
    }).promise;
    const { fnArray, argsArray } = await (await document.getPage(1)).getOperatorList();
    const transforms = fnArray.flatMap((fn, index) =>
      fn === OPS.transform ? [Array.from(argsArray[index] as number[])] : [],
    );
    expect(transforms).toContainEqual([0, 1, -1, 0, 600, 0]);
  });

  it('ページの数を返す', async () => {
    const opened = await openRubyPdf(SOURCE, STYLE, FONTS);

    expect(opened.ok && opened.value.pageCount).toBe(source.length);
  });
});

describe('openRubyPdf の開けない PDF', () => {
  it('開くパスワードのある PDF のとき、encrypted を返す', async () => {
    const result = await openRubyPdf(new Uint8Array(buildEncryptedPdf('secret')), STYLE, FONTS);

    expect(result).toEqual({ ok: false, error: 'encrypted' });
  });

  it('権限のパスワードだけの PDF（開くパスワードが空）のとき、encrypted を返す', async () => {
    const result = await openRubyPdf(new Uint8Array(buildEncryptedPdf('')), STYLE, FONTS);

    expect(result).toEqual({ ok: false, error: 'encrypted' });
  });

  it('PDF でないとき、unreadable を返す', async () => {
    const result = await openRubyPdf(new TextEncoder().encode('not a pdf'), STYLE, FONTS);

    expect(result).toEqual({ ok: false, error: 'unreadable' });
  });
});
