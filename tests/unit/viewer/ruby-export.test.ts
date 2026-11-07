import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { describe, expect, it, vi } from 'vitest';

import type { RubyFonts } from '@/pdf-export/write';
import { DEFAULT_SETTINGS } from '@/settings/model';
import { exportRubyPdf, type RubyExportOptions } from '@/viewer/ruby-export';
import type { RubyBox } from '@/viewer/ruby-layout';

import { buildEncryptedPdf } from '../../e2e/encrypted-pdf';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
/** 見本の PDF */
const SOURCE = new Uint8Array(readFileSync(join(ROOT, 'test-pdfs/out/mixed-layout.pdf')));
const FONTS: RubyFonts = {
  serif: new Uint8Array(readFileSync(join(ROOT, 'src/assets/fonts/ruby-serif.woff2'))),
  sans: new Uint8Array(readFileSync(join(ROOT, 'src/assets/fonts/ruby-sans.woff2'))),
};
/** ページの数 */
const PAGES = 3;

/** 置くルビ（字を並べるのに使うところだけ） */
const BOX = {
  ruby: 'きょう',
  isVertical: false,
  isSpread: false,
  isSerif: true,
  left: 100,
  top: 100,
  width: 30,
  height: 10,
  fontSize: 10,
} as RubyBox;

/**
 * 作り方を作る。
 * @param overrides 変える所
 * @returns 作り方
 */
function optionsOf(overrides: Partial<RubyExportOptions> = {}): RubyExportOptions {
  return {
    document: {
      numPages: PAGES,
      getData: () => Promise.resolve(SOURCE.slice()),
      getPage: () => Promise.resolve({ view: [0, 0, 595, 842] }),
    },
    layouts: {
      settings: DEFAULT_SETTINGS,
      // 2ページめだけ読みを出せない
      layoutPage: (pageNumber) => Promise.resolve(pageNumber === 2 ? undefined : [BOX]),
    },
    loadFonts: () => Promise.resolve(FONTS),
    ...overrides,
  };
}

/**
 * PDF のページの数を、pdf.js で読んで数える。
 * @param data PDF
 * @returns ページの数
 */
async function pageCountOf(data: Uint8Array): Promise<number> {
  const task = getDocument({ data: data.slice(), useSystemFonts: false });
  const document = await task.promise;
  const count = document.numPages;
  await task.destroy();
  return count;
}

describe('exportRubyPdf', () => {
  it('読みを出せなかったページがあるとき、そのページを返し、PDF は作る', async () => {
    const result = await exportRubyPdf(optionsOf());

    expect(result.ok && result.value.failedPages).toEqual([2]);
  });

  it('作った PDF のページの数は、もとの PDF と同じ', async () => {
    const result = await exportRubyPdf(optionsOf());
    if (!result.ok) throw new Error(result.error);

    expect(await pageCountOf(result.value.bytes)).toBe(await pageCountOf(SOURCE));
  });

  it('1ページ済むごとに、済んだページの数を知らせる', async () => {
    const onProgress = vi.fn();

    await exportRubyPdf(optionsOf({ onProgress }));

    expect(onProgress.mock.calls).toEqual([
      [1, PAGES],
      [2, PAGES],
      [3, PAGES],
    ]);
  });

  it('途中で止めたとき、aborted を返し、残りのページの置き場所は出さない', async () => {
    const controller = new AbortController();
    const layoutPage = vi.fn((pageNumber: number) => {
      if (pageNumber === 1) controller.abort();
      return Promise.resolve([BOX]);
    });

    const result = await exportRubyPdf(
      optionsOf({
        signal: controller.signal,
        layouts: { settings: DEFAULT_SETTINGS, layoutPage },
      }),
    );

    expect([result, layoutPage.mock.calls.length]).toEqual([{ ok: false, error: 'aborted' }, 1]);
  });

  it('始める前に止めてあるとき、aborted を返す', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(await exportRubyPdf(optionsOf({ signal: controller.signal }))).toEqual({
      ok: false,
      error: 'aborted',
    });
  });

  it('暗号化した PDF のとき、置き場所を出さずに encrypted を返す', async () => {
    const layoutPage = vi.fn(() => Promise.resolve([BOX]));
    const encrypted = new Uint8Array(buildEncryptedPdf('secret'));

    const result = await exportRubyPdf(
      optionsOf({
        document: {
          numPages: 1,
          getData: () => Promise.resolve(encrypted),
          getPage: () => Promise.resolve({ view: [0, 0, 595, 842] }),
        },
        layouts: { settings: DEFAULT_SETTINGS, layoutPage },
      }),
    );

    expect([result, layoutPage.mock.calls.length]).toEqual([{ ok: false, error: 'encrypted' }, 0]);
  });
});
