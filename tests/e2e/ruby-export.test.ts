// ルビを書き込んだ PDF を作り、pdf.js で描いた絵のルビが、画面のルビと同じ所にあるかを確かめる。
// PDF はバーの「印刷・保存」で作り、できたときの窓の［保存］で受け取る。
// 1画素ずつの比べ方は、DOM の字と Canvas の字の描き方の違いで必ず差が出るので、ルビの箱ごとの字の濃さの重心で比べる。
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Page } from '@playwright/test';
import { degrees, PDFDocument } from 'pdf-lib';
import type * as PdfJs from 'pdfjs-dist';

import { expect, test, TEST_PDF_DIR } from './fixtures';

/** 最初のルビが出るまで待つ時間（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 30_000;
/** 1つのテストの時間の上限（ミリ秒） */
const TEST_TIMEOUT_MS = 120_000;
/** ページの全体が窓に入る大きさ（はみ出た所は描かれず、絵を比べられない） */
const VIEWPORT = { width: 1100, height: 1700 };
/**
 * 重心のずれの平均の上限（画素）。DOM の字と Canvas の字は描き方（画素への合わせ方）が違うので、
 * 位置が合っていても 1 画素くらいはずれる（試作で測ったときは 0.5〜1.5）。
 * ページの箱や向きの扱いを間違えると、何十画素もずれる
 */
const MAX_MEAN_SHIFT_PX = 1.6;
/** 重心のずれの 95% の所の上限（画素） */
const MAX_P95_SHIFT_PX = 2.5;

/** 試す PDF */
interface Case {
  readonly name: string;
  /** test-pdfs/out の PDF */
  readonly file: string;
  /** 向きと箱をずらす書き換え（中身を (120, 80) ずらし、CropBox を内側に寄せ、右へ 270 度回す） */
  readonly isShifted?: boolean;
  /** 字を横倒しに入れて、ページを 90 度回して表示する PDF に書き換えるなら true */
  readonly isSideways?: boolean;
}

const CASES: readonly Case[] = [
  { name: '縦書きの PDF', file: 'vertical-story.pdf' },
  { name: '横書きの PDF', file: 'horizontal-print.pdf' },
  { name: 'ページの箱がずれて回してある PDF', file: 'mixed-direction.pdf', isShifted: true },
  { name: '字を横倒しに入れて回してある PDF', file: 'horizontal-print.pdf', isSideways: true },
];

/**
 * 見本の PDF を、MediaBox・CropBox がずれて /Rotate のある PDF に書き換える（テストの中だけで使う）。
 * @param bytes もとの PDF
 * @returns 書き換えた PDF
 */
async function shiftAndRotate(bytes: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.load(bytes);
  for (const page of document.getPages()) {
    const { width, height } = page.getMediaBox();
    page.translateContent(120, 80);
    page.setMediaBox(120, 80, width, height);
    page.setCropBox(120 + 25, 80 + 35, width - 50, height - 70);
    page.setRotation(degrees(270));
  }
  return document.save();
}

/**
 * 見本の PDF の1ページ目を、横倒しに入れて「90 度回して表示」の指定を付けた PDF に書き換える。
 * @param bytes もとの PDF
 * @returns 書き換えた PDF
 */
async function sideways(bytes: Uint8Array): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const [source] = await document.embedPdf(bytes, [0]);
  if (source === undefined) throw new Error('ページを読めませんでした');
  const page = document.addPage([source.height, source.width]);
  page.drawPage(source, { x: source.height, y: 0, rotate: degrees(90) });
  page.setRotation(degrees(90));
  return document.save();
}

/** ルビの箱ごとの、画面と PDF の字の重心のずれ */
interface ShiftStats {
  /** 比べたルビの数 */
  readonly count: number;
  /** PDF の絵にルビの字がなかった数 */
  readonly missing: number;
  readonly mean: number;
  readonly p95: number;
  readonly max: number;
  /** PDF の重心から画面の重心を引いた長さの平均（決まった向きにずれていないかを見る） */
  readonly dx: number;
  readonly dy: number;
}

/**
 * バーの「印刷・保存」で PDF を作って［保存］で受け取り、画面の1ページめのルビの箱を取り出す。
 * @param page リーダーの画面
 * @returns 作った PDF（base64）、ルビなしのページがあるか、画面のルビの箱（画素。窓の左上から）
 */
async function exportInViewer(page: Page): Promise<{
  base64: string;
  hasFailedPages: boolean;
  regions: { x: number; y: number; w: number; h: number }[];
}> {
  await page.getByRole('button', { name: '印刷・保存', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'ルビ付きの PDF ができました' });
  await expect(dialog).toBeVisible({ timeout: TEST_TIMEOUT_MS });
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '保存' }).click();
  const path = await (await download).path();
  const base64 = (await readFile(path)).toString('base64');
  const hasFailedPages = await dialog.locator('.export-failed').isVisible();
  await dialog.getByRole('button', { name: '閉じる' }).click();
  const regions = await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>(
      '.page[data-page-number="1"] .canvasWrapper',
    );
    if (wrapper === null) throw new Error('1ページめがない');
    return [...wrapper.querySelectorAll<HTMLElement>('.ruby-layer > span')].map((span) => {
      const rect = span.getBoundingClientRect();
      return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
    });
  });
  return { base64, hasFailedPages, regions };
}

/**
 * 画面の絵と PDF の絵の、ルビの箱ごとの字の濃さの重心を比べる。字の濃さは、ルビのない PDF の絵との差。
 * @param page リーダーの画面（絵を読むのに使う）
 * @param images 画面・作った PDF・ルビのない PDF の絵（PNG の data URL）
 * @param images.screen 画面
 * @param images.pdf 作った PDF
 * @param images.base ルビのない PDF
 * @param regions ルビの箱（画素）
 * @returns ずれ
 */
async function compareCentroids(
  page: Page,
  images: { screen: string; pdf: string; base: string },
  regions: readonly { x: number; y: number; w: number; h: number }[],
): Promise<ShiftStats> {
  return page.evaluate(
    async ({ images, regions }) => {
      const pixelsOf = async (url: string): Promise<ImageData> => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (context === null) throw new Error('Canvas が使えない');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, canvas.width, canvas.height);
      };
      const [screen, pdf, base] = await Promise.all(
        [images.screen, images.pdf, images.base].map(pixelsOf),
      );
      if (screen === undefined || pdf === undefined || base === undefined) {
        throw new Error('絵を読めない');
      }
      const ink = (image: ImageData, x: number, y: number): number => {
        const at = (y * image.width + x) * 4;
        let gap = 0;
        for (let channel = 0; channel < 3; channel++) {
          gap = Math.max(
            gap,
            Math.abs((image.data[at + channel] ?? 0) - (base.data[at + channel] ?? 0)),
          );
        }
        return gap;
      };
      const centroid = (
        image: ImageData,
        region: { x: number; y: number; w: number; h: number },
      ): { x: number; y: number; mass: number } => {
        const margin = 2;
        let mass = 0;
        let sx = 0;
        let sy = 0;
        const bottom = Math.min(image.height, base.height, Math.ceil(region.y + region.h + margin));
        const right = Math.min(image.width, base.width, Math.ceil(region.x + region.w + margin));
        for (let y = Math.max(0, Math.floor(region.y - margin)); y < bottom; y++) {
          for (let x = Math.max(0, Math.floor(region.x - margin)); x < right; x++) {
            const weight = ink(image, x, y);
            mass += weight;
            sx += weight * x;
            sy += weight * y;
          }
        }
        return { x: mass === 0 ? 0 : sx / mass, y: mass === 0 ? 0 : sy / mass, mass };
      };
      const shifts: number[] = [];
      let missing = 0;
      const dxs: number[] = [];
      const dys: number[] = [];
      for (const region of regions) {
        const onScreen = centroid(screen, region);
        if (onScreen.mass === 0) continue;
        const inPdf = centroid(pdf, region);
        if (inPdf.mass === 0) {
          missing++;
          continue;
        }
        shifts.push(Math.hypot(onScreen.x - inPdf.x, onScreen.y - inPdf.y));
        dxs.push(inPdf.x - onScreen.x);
        dys.push(inPdf.y - onScreen.y);
      }
      const sorted = shifts.toSorted((a, b) => a - b);
      return {
        count: shifts.length,
        missing,
        mean: shifts.reduce((sum, shift) => sum + shift, 0) / Math.max(shifts.length, 1),
        p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
        max: sorted.at(-1) ?? 0,
        dx: dxs.reduce((a, b) => a + b, 0) / Math.max(dxs.length, 1),
        dy: dys.reduce((a, b) => a + b, 0) / Math.max(dys.length, 1),
      };
    },
    { images, regions },
  );
}

/**
 * PDF を pdf.js で、画面の1ページめと同じ大きさに描く。
 * @param page リーダーの画面
 * @param base64 PDF（base64）
 * @returns 絵（PNG の data URL。窓と同じ大きさで、ページは画面と同じ所）と、PDF の単位あたりの画素の数
 */
async function renderFirstPage(
  page: Page,
  base64: string,
): Promise<{ url: string; pixelsPerUnit: number }> {
  return page.evaluate(async (base64) => {
    const lib = (globalThis as unknown as { pdfjsLib: typeof PdfJs }).pdfjsLib;
    const wrapper = document.querySelector<HTMLElement>(
      '.page[data-page-number="1"] .canvasWrapper',
    );
    if (wrapper === null) throw new Error('1ページめがない');
    const frame = wrapper.getBoundingClientRect();
    const task = lib.getDocument({
      data: Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0)),
      cMapUrl: `${location.origin}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${location.origin}/standard_fonts/`,
      wasmUrl: `${location.origin}/wasm/`,
      iccUrl: `${location.origin}/iccs/`,
      useSystemFonts: false,
    });
    const pdfPage = await (await task.promise).getPage(1);
    const pixelsPerUnit = frame.width / pdfPage.getViewport({ scale: 1 }).width;
    const viewport = pdfPage.getViewport({
      scale: pixelsPerUnit,
      offsetX: frame.left,
      offsetY: frame.top,
    });
    const canvas = document.createElement('canvas');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    await pdfPage.render({ canvas, viewport }).promise;
    const url = canvas.toDataURL('image/png');
    await task.destroy();
    return { url, pixelsPerUnit };
  }, base64);
}

for (const testCase of CASES) {
  test(`${testCase.name}にルビを書き込んだとき、PDF のルビが画面のルビと同じ所に出る`, async ({
    page,
    extensionId,
  }) => {
    test.setTimeout(TEST_TIMEOUT_MS);
    const original = new Uint8Array(await readFile(join(TEST_PDF_DIR, testCase.file)));
    let input: Uint8Array = original;
    if (testCase.isShifted === true) input = await shiftAndRotate(original);
    if (testCase.isSideways === true) input = await sideways(original);
    const dir = await mkdtemp(join(tmpdir(), 'yomigana-export-'));
    try {
      const inputPath = join(dir, 'input.pdf');
      await writeFile(inputPath, input);
      await page.setViewportSize(VIEWPORT);
      await page.goto(`chrome-extension://${extensionId}/viewer.html`);
      const chooser = page.waitForEvent('filechooser');
      await page.getByRole('button', { name: 'ファイルを開く' }).click();
      await (await chooser).setFiles(inputPath);
      const wrapper = page.locator('.page[data-page-number="1"] .canvasWrapper');
      await expect(wrapper.locator('.ruby-layer > span').first()).toBeAttached({
        timeout: FIRST_RUBY_TIMEOUT_MS,
      });
      await page.evaluate(() => document.fonts.ready);

      const exported = await exportInViewer(page);
      const screen = `data:image/png;base64,${(await page.screenshot()).toString('base64')}`;
      const pdf = await renderFirstPage(page, exported.base64);
      const base = await renderFirstPage(page, Buffer.from(input).toString('base64'));
      const stats = await compareCentroids(
        page,
        { screen, pdf: pdf.url, base: base.url },
        exported.regions,
      );
      test.info().annotations.push({
        type: '重心のずれ（画素）',
        description: JSON.stringify({
          pixelsPerUnit: pdf.pixelsPerUnit,
          ...stats,
          inputBytes: input.length,
          outputBytes: Buffer.from(exported.base64, 'base64').length,
        }),
      });

      expect({
        hasFailedPages: exported.hasFailedPages,
        missing: stats.missing,
        isCompared: stats.count > 0,
        isMeanClose: stats.mean <= MAX_MEAN_SHIFT_PX,
        isP95Close: stats.p95 <= MAX_P95_SHIFT_PX,
      }).toEqual({
        hasFailedPages: false,
        missing: 0,
        isCompared: true,
        isMeanClose: true,
        isP95Close: true,
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}
