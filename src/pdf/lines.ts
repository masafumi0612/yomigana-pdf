// 本文のランを、行（縦書きの列・横書きの行）にまとめる。
// 縦書きの列の中心にある短い横書きのラン（縦中横の数字など）は、その列の一部にする。
import type { PlacedGlyph, TextRun } from './glyphs';
import { centerX, centerY, unionRect } from './rect';
import type { Direction, Rect } from './types';

/** 1つの行（縦書きなら列） */
export interface TextLine {
  /** 字の並ぶ向き */
  readonly direction: Direction;
  /** 読む順の字 */
  readonly glyphs: readonly PlacedGlyph[];
  /** すべての字を囲む箱 */
  readonly rect: Rect;
  /** 字の大きさ（行の最初のラン） */
  readonly size: number;
}

/** 組み立て中の行 */
interface LineDraft {
  readonly direction: Direction;
  readonly glyphs: PlacedGlyph[];
  rect: Rect;
  readonly size: number;
}

/** 同じ列と見なす、列の中心のずれの上限（字） */
const SAME_COLUMN_EM = 0.3;
/** 同じ列につなぐ、上下のすきまの上限（字） */
const COLUMN_GAP_EM = 2;
/** 同じ列と見なす字の大きさの比の上限 */
const COLUMN_SIZE_RATIO = 1.25;
/** 縦中横と見なす、横書きのランの字の数の上限 */
const TCY_MAX_GLYPHS = 3;
/** 縦中横と見なす、列の中心とのずれの上限（字） */
const TCY_AXIS_EM = 0.5;
/** 縦中横と見なす、列の上下の端からはみ出してよい長さ（字） */
const TCY_REACH_EM = 1;
/** 同じ行と見なす、下の端のずれの上限（字） */
const SAME_ROW_EM = 0.3;
/** 同じ行につなぐ、左右のすきまの上限（字） */
const ROW_GAP_EM = 1.5;
/** 同じ行と見なす字の大きさの比の上限（これより大きく違えば見出しなどの別の行） */
const ROW_SIZE_RATIO = 1.6;

/**
 * 2つの大きさの比（大きいほう ÷ 小さいほう）。
 * @param p 1つめの大きさ
 * @param q 2つめの大きさ
 * @returns 1 以上の比
 */
function sizeRatio(p: number, q: number): number {
  return Math.max(p, q) / Math.min(p, q);
}

/**
 * ランを行に足す。
 * @param line 組み立て中の行
 * @param run 足すラン
 */
function addRun(line: LineDraft, run: TextRun): void {
  line.glyphs.push(...run.glyphs);
  line.rect = unionRect([line.rect, run.rect]);
}

/**
 * 縦書きのランが、組み立て中の列に続くか。
 * @param column 組み立て中の列
 * @param run 縦書きのラン
 * @returns 続くなら true
 */
function continuesColumn(column: LineDraft, run: TextRun): boolean {
  const gap = Math.max(column.rect.y1 - run.rect.y2, run.rect.y1 - column.rect.y2, 0);
  return (
    Math.abs(centerX(column.rect) - centerX(run.rect)) < column.size * SAME_COLUMN_EM &&
    sizeRatio(column.size, run.size) < COLUMN_SIZE_RATIO &&
    gap < column.size * COLUMN_GAP_EM
  );
}

/**
 * 横書きのランが、列の中の縦中横か。
 * @param column 列
 * @param run 横書きのラン
 * @returns 縦中横なら true
 */
function isTateChuYoko(column: LineDraft, run: TextRun): boolean {
  const reach = column.size * TCY_REACH_EM;
  return (
    run.glyphs.length <= TCY_MAX_GLYPHS &&
    Math.abs(centerX(column.rect) - centerX(run.rect)) < column.size * TCY_AXIS_EM &&
    run.rect.y1 <= column.rect.y2 + reach &&
    run.rect.y2 >= column.rect.y1 - reach
  );
}

/**
 * 横書きのランが、組み立て中の行に続くか。
 * @param row 組み立て中の行
 * @param run 横書きのラン
 * @returns 続くなら true
 */
function continuesRow(row: LineDraft, run: TextRun): boolean {
  const reach = row.size * ROW_GAP_EM;
  return (
    Math.abs(row.rect.y1 - run.rect.y1) < row.size * SAME_ROW_EM &&
    sizeRatio(row.size, run.size) < ROW_SIZE_RATIO &&
    run.rect.x1 <= row.rect.x2 + reach &&
    run.rect.x2 >= row.rect.x1 - reach
  );
}

/**
 * ランから新しい行を作る。
 * @param run 最初のラン
 * @param direction 字の並ぶ向き
 * @returns 組み立て中の行
 */
function startLine(run: TextRun, direction: Direction): LineDraft {
  return { direction, glyphs: [...run.glyphs], rect: run.rect, size: run.size };
}

/**
 * 本文のランを、縦書きの列と横書きの行にまとめる。
 * 列の字は上から（縦中横の字は左から）、行の字は左から並べる。
 * @param runs 本文のラン
 * @returns 行（並べる順は決めない）
 */
export function buildLines(runs: readonly TextRun[]): TextLine[] {
  const columns: LineDraft[] = [];
  const verticalRuns = runs.filter((run) => run.direction === 'vertical');
  for (const run of verticalRuns.toSorted((p, q) => q.rect.y2 - p.rect.y2)) {
    const column = columns.find((draft) => continuesColumn(draft, run));
    if (column === undefined) columns.push(startLine(run, 'vertical'));
    else addRun(column, run);
  }

  const rows: LineDraft[] = [];
  const horizontalRuns = runs
    .filter((run) => run.direction === 'horizontal')
    .toSorted((p, q) => q.rect.y1 - p.rect.y1 || p.rect.x1 - q.rect.x1);
  for (const run of horizontalRuns) {
    const column = columns.find((draft) => isTateChuYoko(draft, run));
    if (column !== undefined) {
      addRun(column, run);
      continue;
    }
    const row = rows.find((draft) => continuesRow(draft, run));
    if (row === undefined) rows.push(startLine(run, 'horizontal'));
    else addRun(row, run);
  }

  for (const column of columns) {
    column.glyphs.sort((p, q) => centerY(q.rect) - centerY(p.rect) || p.rect.x1 - q.rect.x1);
  }
  for (const row of rows) row.glyphs.sort((p, q) => p.rect.x1 - q.rect.x1);
  return [...columns, ...rows];
}
