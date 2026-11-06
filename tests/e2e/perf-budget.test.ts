// ルビが出るまでの時間・辞書の読み込み・メモリを測り、表と JSON に残す。
// 警告の線を超えても失敗にしない（CI の機械の速さで揺れるため）。測れないときだけ失敗にする
import { appendFile, writeFile } from 'node:fs/promises';

import type { BrowserContext, Page } from '@playwright/test';

import {
  attachPage,
  type CdpPeer,
  type HeapUsage,
  heapUsage,
  listTargets,
  measuredDurations,
  openCdp,
} from './cdp-relay';
import { expect, openFromFile, test } from './fixtures';

/**
 * 性能の警告の線。**合否の線ではない**。超えたら表に印を付け、GitHub Actions では
 * `::warning::` を出すが、テストは通す。
 *
 * 設計の目標（1ページの処理 60 ms 以内・辞書の読み込み 1 秒以内）は手元の速い機械での目安で、
 * CI の機械は遅く揺れるので、E2E ではそれより緩いこの線で見張る。
 */
const WARNING_LINES = {
  /**
   * 辞書を読み込んだあとに開いた PDF で、見えているページ（1ページめ）を描き終えてから、
   * そのページにルビの層が出るまで（ミリ秒）。拡大で描き直したときの置き直しにも使う。
   * src/viewer/ruby-pages.ts の performance.measure で測る。辞書の読み込みを含む最初の PDF には
   * 線を引かない（そちらは辞書の線で見張る）
   */
  warmRubyMs: 300,
  /**
   * offscreen document の中の Worker が、辞書を初めて読み込み終えるまで（ミリ秒）。
   * src/entrypoints/offscreen/reading.worker.ts の performance.measure で測る
   */
  dictionaryLoadMs: 2000,
  /**
   * リーダーと offscreen document のメモリ（MB）。それぞれのページと中の Worker の、
   * JS のヒープ・DOM のヒープ・ArrayBuffer の中身の合計。同じ isolate は1回だけ数える
   */
  memoryMb: 300,
} as const;

/** ページを描き終えてからルビの層を出すまでの名前（src/viewer/ruby-pages.ts） */
const RUBY_LAYER_MEASURE = 'yomigana-pdf:ruby-layer';
/** 読みの問い合わせの名前（src/viewer/ruby-pages.ts） */
const READINGS_MEASURE = 'yomigana-pdf:readings';
/** 辞書を読み込み終えるまでの名前（src/entrypoints/offscreen/reading.worker.ts） */
const DICTIONARY_MEASURE = 'yomigana-pdf:dictionary';

/** 辞書の読み込みを含めて、最初のルビが出るまで待つ時間の上限（ミリ秒） */
const FIRST_RUBY_TIMEOUT_MS = 15_000;
/** このテスト全体の時間の上限（PDF を3つ開き、メモリも測る。ミリ秒） */
const TEST_TIMEOUT_MS = 90_000;
/** 1 MB のバイト数 */
const BYTES_PER_MB = 1024 * 1024;

/** 結果を書く JSON のファイル名（Playwright の出力の置き場所の中） */
const RESULT_FILE = 'perf-budget.json';

/** 測る PDF（test-pdfs/out の中。最初の1つで辞書を読み込む。sample.pdf は拡張に同梱する見本） */
const PDF_FILES = ['vertical-story.pdf', 'horizontal-print.pdf', 'sample.pdf'] as const;

/** 結果の1行 */
interface PerfRow {
  /** 何を測ったか */
  readonly name: string;
  /** 測った値 */
  readonly value: number;
  /** 単位 */
  readonly unit: 'ms' | 'MB';
  /** 警告の線（ないものは測って残すだけ） */
  readonly line?: number;
}

/** ページを開いて測った時間 */
interface OpenTiming {
  /** 1ページめを描き終えてから、ルビの層が出るまで（ミリ秒） */
  readonly rubyMs: number;
  /** 開いてから最初の読みの問い合わせ（ミリ秒） */
  readonly readingsMs: number;
}

/**
 * 1ページめを描き終えてから、ルビの層を出すまでの時間を引く。
 * @param page 画面
 * @returns 測った順の時間（ミリ秒）
 */
async function firstPageRubyDurations(page: Page): Promise<number[]> {
  return page.evaluate(
    (name) =>
      performance
        .getEntriesByName(name, 'measure')
        .filter(
          (entry) =>
            entry instanceof PerformanceMeasure &&
            (entry.detail as { pageNumber?: number } | undefined)?.pageNumber === 1,
        )
        .map((entry) => entry.duration),
    RUBY_LAYER_MEASURE,
  );
}

/**
 * PDF を開き、1ページめにルビの層が出るまでを測る。
 * リーダーを開き直すので、前の PDF の測った値は残らない。
 * @param page 画面
 * @param extensionId 入れた拡張の ID
 * @param file test-pdfs/out からの PDF の名前
 * @returns 測った時間
 */
async function openAndMeasure(page: Page, extensionId: string, file: string): Promise<OpenTiming> {
  await openFromFile(page, extensionId, file);
  await expect(page.locator('.page[data-page-number="1"] .ruby-layer span').first()).toBeAttached({
    timeout: FIRST_RUBY_TIMEOUT_MS,
  });
  await expect.poll(async () => (await firstPageRubyDurations(page)).length).toBeGreaterThan(0);
  const [rubyMs = Number.NaN] = await firstPageRubyDurations(page);
  const [readingsMs = Number.NaN] = await page.evaluate(
    (name) => performance.getEntriesByName(name, 'measure').map((entry) => entry.duration),
    READINGS_MEASURE,
  );
  return { rubyMs, readingsMs };
}

/**
 * 拡大し、1ページめを描き直してからルビの層を置き直すまでを測る（読みは問い合わせ直さない）。
 * @param page 画面
 * @returns 測った時間（ミリ秒）
 */
async function zoomAndMeasure(page: Page): Promise<number> {
  const before = (await firstPageRubyDurations(page)).length;
  await page.getByRole('button', { name: '拡大' }).click();
  await expect
    .poll(async () => (await firstPageRubyDurations(page)).length)
    .toBeGreaterThan(before);
  return (await firstPageRubyDurations(page))[before] ?? Number.NaN;
}

/**
 * 相手を探す。
 * @param root 画面の CDP の口
 * @param type 種類
 * @param path 拡張の中のページの道（例：/offscreen.html）
 * @returns 相手の ID
 */
async function findTarget(root: CdpPeer, type: string, path: string): Promise<string> {
  const found = (await listTargets(root)).find(
    (target) => target.type === type && new URL(target.url).pathname === path,
  );
  if (found === undefined) {
    throw new Error(`${path} が見つからない`);
  }
  return found.targetId;
}

/**
 * ページにつなぎ、中の Worker がそろうまで待つ。
 * @param root 画面の CDP の口
 * @param targetId ページの ID
 * @param workerName 待つ Worker の URL に入る名前
 * @returns ページと、その Worker
 */
async function attachWithWorker(
  root: CdpPeer,
  targetId: string,
  workerName: string,
): Promise<{ page: CdpPeer; worker: CdpPeer }> {
  const { page, workers } = await attachPage(root, targetId);
  const findWorker = (): CdpPeer | undefined =>
    [...workers].find(([url]) => url.includes(workerName))?.[1];
  await expect.poll(() => findWorker() !== undefined).toBe(true);
  const worker = findWorker();
  if (worker === undefined) throw new Error(`${workerName} の Worker につなげない`);
  return { page, worker };
}

/**
 * 大きさを MB にする。同じ isolate（同じプロセスの拡張の画面どうし）は1回だけ数える。
 * @param usages 測ったメモリ
 * @returns 合計（MB）
 */
function totalMb(usages: readonly HeapUsage[]): number {
  const byIsolate = new Map(usages.map((usage) => [usage.isolateId, usage]));
  const bytes = [...byIsolate.values()].reduce(
    (sum, usage) => sum + usage.usedSize + usage.embedderHeapUsedSize + usage.backingStorageSize,
    0,
  );
  return bytes / BYTES_PER_MB;
}

/**
 * 警告の線を超えたか。
 * @param row 結果の1行
 * @returns 超えたら true
 */
function isOverLine(row: PerfRow): boolean {
  return row.line !== undefined && row.value > row.line;
}

/**
 * 結果を Markdown の表にする（テストの出力と GitHub Actions のまとめに使う）。
 * @param rows 結果
 * @returns 表
 */
function toTable(rows: readonly PerfRow[]): string {
  const lines = rows.map((row) => {
    const line = row.line === undefined ? '—' : `${String(row.line)} ${row.unit}`;
    const mark = row.line === undefined ? '—' : isOverLine(row) ? '超えた' : 'OK';
    return `| ${row.name} | ${row.value.toFixed(0)} ${row.unit} | ${line} | ${mark} |`;
  });
  return ['| 項目 | 測った値 | 警告の線 | 判定 |', '| --- | --- | --- | --- |', ...lines].join(
    '\n',
  );
}

/**
 * 結果を、テストの出力・JSON・GitHub Actions のまとめと警告に出す。
 * @param rows 結果
 * @param memory 相手ごとのメモリ
 */
async function report(rows: readonly PerfRow[], memory: Record<string, HeapUsage>): Promise<void> {
  const table = toTable(rows);
  process.stdout.write(`\n性能の測定（警告の線は合否に使わない）\n${table}\n`);

  const resultPath = test.info().outputPath(RESULT_FILE);
  await writeFile(
    resultPath,
    JSON.stringify({ warningLines: WARNING_LINES, rows, memory }, undefined, 2),
  );
  await test.info().attach(RESULT_FILE, { path: resultPath, contentType: 'application/json' });

  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary !== undefined && summary !== '') {
    await appendFile(summary, `\n### 性能の測定（警告の線は合否に使わない）\n\n${table}\n`);
  }
  for (const row of rows.filter(isOverLine)) {
    const message = `${row.name}が警告の線を超えた：${row.value.toFixed(0)} ${row.unit}（線 ${String(row.line)} ${row.unit}）`;
    test.info().annotations.push({ type: 'warning', description: message });
    if (process.env.GITHUB_ACTIONS === 'true') {
      process.stdout.write(`::warning title=性能の警告の線::${message}\n`);
    }
  }
}

/**
 * 設定の画面など、測るリーダーのほかの画面を閉じる（同じ isolate のメモリに入るため）。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @param page 測るリーダーの画面
 */
async function closeOtherPages(context: BrowserContext, page: Page): Promise<void> {
  await Promise.all(
    context
      .pages()
      .filter((other) => other !== page)
      .map((other) => other.close()),
  );
}

test('ルビが出るまでの時間・辞書の読み込み・メモリを測る（警告の線を超えても止めない）', async ({
  context,
  page,
  extensionId,
}) => {
  test.setTimeout(TEST_TIMEOUT_MS);
  await closeOtherPages(context, page);

  // 最初の PDF は、offscreen document を作り、辞書を読み込むところから
  const [coldFile, ...warmFiles] = PDF_FILES;
  const cold = await openAndMeasure(page, extensionId, coldFile);
  const warm: { file: string; timing: OpenTiming }[] = [];
  for (const file of warmFiles) {
    warm.push({ file, timing: await openAndMeasure(page, extensionId, file) });
  }
  const zoomMs = await zoomAndMeasure(page);

  const root = await openCdp(context, page);
  const offscreen = await attachWithWorker(
    root,
    await findTarget(root, 'background_page', '/offscreen.html'),
    'reading.worker',
  );
  const dictionaryLoads = await measuredDurations(offscreen.worker, DICTIONARY_MEASURE);
  // 辞書は offscreen document の中で1回だけ読み込む
  expect(dictionaryLoads).toHaveLength(1);

  const viewer = await attachWithWorker(
    root,
    await findTarget(root, 'page', '/viewer.html'),
    'pdf.worker',
  );
  const memory = {
    viewer: await heapUsage(viewer.page),
    pdfWorker: await heapUsage(viewer.worker),
    offscreen: await heapUsage(offscreen.page),
    readingWorker: await heapUsage(offscreen.worker),
  };

  const rows: PerfRow[] = [
    {
      name: `ルビが出るまで・辞書の読み込みを含む（${coldFile}）`,
      value: cold.rubyMs,
      unit: 'ms',
    },
    ...warm.map(({ file, timing }) => ({
      name: `ルビが出るまで・辞書を読み込んだあと（${file}）`,
      value: timing.rubyMs,
      unit: 'ms' as const,
      line: WARNING_LINES.warmRubyMs,
    })),
    {
      name: `ルビを置き直すまで・拡大したとき（${warmFiles.at(-1) ?? ''}）`,
      value: zoomMs,
      unit: 'ms',
      line: WARNING_LINES.warmRubyMs,
    },
    ...warm.map(({ file, timing }) => ({
      name: `最初の読みの問い合わせ・辞書を読み込んだあと（${file}）`,
      value: timing.readingsMs,
      unit: 'ms' as const,
    })),
    {
      name: '辞書の初めての読み込み',
      value: dictionaryLoads[0] ?? Number.NaN,
      unit: 'ms',
      line: WARNING_LINES.dictionaryLoadMs,
    },
    {
      name: 'メモリ（リーダーと offscreen document）',
      value: totalMb(Object.values(memory)),
      unit: 'MB',
      line: WARNING_LINES.memoryMb,
    },
  ];
  await report(rows, memory);

  expect(rows.every((row) => Number.isFinite(row.value))).toBe(true);
});
