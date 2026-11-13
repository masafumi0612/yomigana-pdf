import type { PageViewport } from 'pdfjs-dist';
import { describe, expect, it, vi } from 'vitest';

import type { ReadingResult } from '@/messaging/messages';
import { DEFAULT_SETTINGS, type Settings } from '@/settings/model';
import type { Level } from '@/text/types';
import type { DrawRecorder } from '@/viewer/draw-recorder';
import { createPageLayouts, type PageLayouts } from '@/viewer/page-layout';
import { createRubyPages, type RubyPages, type RubyPageView } from '@/viewer/ruby-pages';

import { contentOf, unmarkedColumn } from '../pdf/make-items';

// ルビの層は DOM を作るので、置きかえる。ここで確かめるのは、取っておく文と向きだけ
vi.mock('@/viewer/ruby-layer', () => ({
  RUBY_BAND_CLASS: 'ruby-band',
  showRubyLayer: () => ({ isConnected: true, remove: () => undefined }),
}));

/** 問い合わせ中の読み */
interface PendingRead {
  readonly texts: readonly string[];
  readonly level: Level;
  readonly answer: () => void;
}

/** 縦書きの印のない縦書きの列（向きの自信が 1 未満の縦書きのかたまりになる） */
const CONTENT = contentOf(unmarkedColumn('今日は朝から', 300, 700));

const view: RubyPageView = {
  div: {} as HTMLDivElement,
  canvas: undefined,
  viewport: { viewBox: [0, 0, 600, 800] } as unknown as PageViewport,
  // 使うところだけを持つ、ページのにせもの
  pdfPage: {
    rotate: 0,
    view: [0, 0, 600, 800],
    getTextContent: () => Promise.resolve(CONTENT),
    commonObjs: { has: () => false, get: () => undefined },
  } as unknown as RubyPageView['pdfPage'],
};

/**
 * 読みの問い合わせを、テストが答えるまで待たせる部品を作る。
 * @returns 待たせている読みと、置き場所を出す部品と、ルビの層の部品
 */
function setUp(): {
  pending: PendingRead[];
  layouts: PageLayouts;
  pages: RubyPages;
  settings: Settings;
} {
  const pending: PendingRead[] = [];
  const settings: Settings = { ...DEFAULT_SETTINGS, level: 'all' };
  const recorder: DrawRecorder = { watch: () => undefined, take: () => [] };
  const layouts = createPageLayouts({
    getPage: () => Promise.resolve(undefined),
    recorder,
    settings,
    readTexts: (texts, level) =>
      new Promise<ReadingResult>((resolve) => {
        pending.push({
          texts,
          level,
          answer: () => {
            resolve({ ok: true, value: texts.map(() => []) });
          },
        });
      }),
  });
  const pages = createRubyPages({
    layouts,
    getPageView: () => view,
    recorder,
    root: {
      style: { setProperty: () => undefined },
      classList: { toggle: () => false },
    } as unknown as HTMLElement,
  });
  return { pending, layouts, pages, settings };
}

/**
 * 待っている処理を進め、問い合わせが届くまで待つ。
 * @param pending 待たせている読み
 * @param count 届くのを待つ数
 */
async function waitForReads(pending: readonly PendingRead[], count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(pending).toHaveLength(count);
  });
}

/**
 * 終わるまで、届いた問い合わせに順に答え続ける。
 * @param pending 待たせている読み
 * @param work 終わるのを待つ処理
 */
async function answerUntilDone(pending: PendingRead[], work: Promise<unknown>): Promise<void> {
  const done = work.then(() => true);
  for (;;) {
    for (const read of pending.splice(0)) read.answer();
    const tick = new Promise<boolean>((resolve) => setTimeout(resolve, 0, false));
    if (await Promise.race([done, tick])) return;
  }
}

/**
 * ページ 1 を描き終え、最初の読みに答える。
 * @param pending 待たせている読み
 * @param pages ルビの層の部品
 */
async function showFirstPage(pending: PendingRead[], pages: RubyPages): Promise<void> {
  const rendered = pages.handlePageRendered({ source: view, pageNumber: 1 });
  await waitForReads(pending, 1);
  pending.splice(0).forEach((read) => {
    read.answer();
  });
  await rendered;
}

describe('createRubyPages', () => {
  it('向きを決め直す読みの途中で段階が変わり、向きの読みが先に返ったとき、決めた向きが残る', async () => {
    const { pending, layouts, pages, settings } = setUp();
    await showFirstPage(pending, pages);
    expect(layouts.blocksOf(1)[0]?.direction).toBe('vertical');

    const choosing = pages.setBlockDirection(1, 0, 'horizontal');
    await waitForReads(pending, 1);
    const changing = pages.applySettings({ ...settings, level: 'g3' });
    await waitForReads(pending, 2);
    await answerUntilDone(pending, Promise.all([choosing, changing]));

    expect(layouts.blocksOf(1)[0]?.direction).toBe('horizontal');
  });

  it('向きを決め直す読みの途中で段階が変わり、段階の読みが先に返ったとき、決めた向きが残る', async () => {
    const { pending, layouts, pages, settings } = setUp();
    await showFirstPage(pending, pages);

    const choosing = pages.setBlockDirection(1, 0, 'horizontal');
    await waitForReads(pending, 1);
    const changing = pages.applySettings({ ...settings, level: 'g3' });
    await waitForReads(pending, 2);
    pending.reverse();
    await answerUntilDone(pending, Promise.all([choosing, changing]));

    expect(layouts.blocksOf(1)[0]?.direction).toBe('horizontal');
  });

  it('向きを決め直したあとに段階が変わったとき、決めた向きのまま新しい段階で読み直す', async () => {
    const { pending, layouts, pages, settings } = setUp();
    await showFirstPage(pending, pages);
    await answerUntilDone(pending, pages.setBlockDirection(1, 0, 'horizontal'));

    const changing = pages.applySettings({ ...settings, level: 'g3' });
    await waitForReads(pending, 1);
    const [read] = pending;
    await answerUntilDone(pending, changing);

    expect([read?.level, layouts.blocksOf(1)[0]?.direction]).toEqual(['g3', 'horizontal']);
  });
});
