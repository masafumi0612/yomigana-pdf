// PDF の中にもとからあるルビを見分ける。
// かなだけの小さい字のランが、1.6 倍以上大きい字のすぐ横（縦書きは右、横書きは上）にあればルビと見なす。
// となりの字と比べるので、大きいルビの付いた見出しでも見つかる。
import type { PlacedGlyph, TextRun } from './glyphs';
import { centerX, overlapLength, unionRect } from './rect';
import type { Direction, Rect } from './types';

/** もとからあるルビ（となり合うルビのランをつないだもの） */
export interface RubyGroup {
  /** ルビの文字（空白を除く） */
  readonly reading: string;
  /** ルビを囲む箱 */
  readonly rect: Rect;
  /** ルビの字の大きさ */
  readonly size: number;
  /** 親字の並ぶ向き */
  readonly baseDirection: Direction;
}

/** ランを、本文とルビに分けた結果 */
export interface RubySplit {
  /** 本文のラン */
  readonly body: readonly TextRun[];
  /** ルビ */
  readonly rubies: readonly RubyGroup[];
}

/** かなだけ（ルビになれる字だけ）の文字列 */
const KANA_ONLY = /^[ぁ-ゖァ-ヺー・]+$/u;
/** 親字はルビの字の 1.6 倍以上の大きさ */
const RUBY_SIZE_RATIO = 1.6;
/** ルビと親字のすきまの範囲（親字の大きさに対する比）。少し重なっていてもよい */
const RUBY_GAP_MIN_EM = -0.4;
const RUBY_GAP_MAX_EM = 0.5;
/** ルビのランをつなぐ、すきまの上限（ルビの字の大きさに対する比） */
const RUBY_JOIN_EM = 1;
/** ルビのランを同じ並びと見なす、位置のずれの上限（ルビの字の大きさに対する比） */
const RUBY_ALIGN_EM = 0.3;
/** 親字と見なす、ルビと重なる長さの下限（親字の長さに対する比） */
const BASE_OVERLAP_RATIO = 1 / 3;

/**
 * ルビの箱が、親字の箱のすぐ横（縦書きは右、横書きは上）にあるか。
 * @param ruby ルビの箱
 * @param base 親字の箱
 * @param baseSize 親字の大きさ
 * @param baseDirection 親字の並ぶ向き
 * @returns すぐ横なら true
 */
function isBeside(ruby: Rect, base: Rect, baseSize: number, baseDirection: Direction): boolean {
  const isVertical = baseDirection === 'vertical';
  const gap = isVertical ? ruby.x1 - base.x2 : ruby.y1 - base.y2;
  const overlap = isVertical
    ? overlapLength(ruby.y1, ruby.y2, base.y1, base.y2)
    : overlapLength(ruby.x1, ruby.x2, base.x1, base.x2);
  return gap > baseSize * RUBY_GAP_MIN_EM && gap < baseSize * RUBY_GAP_MAX_EM && overlap > 0;
}

/**
 * ランがルビなら、その親字の並ぶ向きを返す。
 * @param run 調べるラン
 * @param runs ページのすべてのラン
 * @returns 親字の並ぶ向き。ルビでなければ undefined
 */
function rubyBaseDirection(run: TextRun, runs: readonly TextRun[]): Direction | undefined {
  if (!KANA_ONLY.test(run.text)) return undefined;
  const base = runs.find(
    (other) =>
      other.size >= run.size * RUBY_SIZE_RATIO &&
      isBeside(run.rect, other.rect, other.size, other.direction),
  );
  return base?.direction;
}

/**
 * ルビのラン next が、ルビ group のすぐ後ろに同じ並びで続くか。
 * @param group つないでいるルビ
 * @param next 次のルビのラン
 * @param baseDirection next の親字の並ぶ向き
 * @returns 続くなら true
 */
function continuesRuby(group: RubyGroup, next: TextRun, baseDirection: Direction): boolean {
  if (group.baseDirection !== baseDirection) return false;
  const size = Math.max(group.size, next.size);
  if (baseDirection === 'vertical') {
    return (
      Math.abs(centerX(group.rect) - centerX(next.rect)) < size * RUBY_ALIGN_EM &&
      group.rect.y1 - next.rect.y2 < size * RUBY_JOIN_EM
    );
  }
  return (
    Math.abs(group.rect.y1 - next.rect.y1) < size * RUBY_ALIGN_EM &&
    next.rect.x1 - group.rect.x2 < size * RUBY_JOIN_EM
  );
}

/**
 * ランを、本文と、もとからあるルビに分ける。となり合うルビのランは1つのルビにつなぐ。
 * @param runs ページのすべてのラン
 * @returns 本文のランとルビ
 */
export function splitRuby(runs: readonly TextRun[]): RubySplit {
  const body: TextRun[] = [];
  const found: { run: TextRun; baseDirection: Direction }[] = [];
  for (const run of runs) {
    const baseDirection = rubyBaseDirection(run, runs);
    if (baseDirection === undefined) body.push(run);
    else found.push({ run, baseDirection });
  }
  // 並ぶ順（縦書きのルビは上から、横書きのルビは左から）にしてから、続くものをつなぐ
  const order = (entry: (typeof found)[number]): number =>
    entry.baseDirection === 'vertical' ? -entry.run.rect.y2 : entry.run.rect.x1;
  found.sort((p, q) => p.baseDirection.localeCompare(q.baseDirection) || order(p) - order(q));
  const rubies: RubyGroup[] = [];
  for (const { run, baseDirection } of found) {
    const index = rubies.findIndex((group) => continuesRuby(group, run, baseDirection));
    const group = rubies[index];
    if (group === undefined) {
      rubies.push({ reading: run.text, rect: run.rect, size: run.size, baseDirection });
    } else {
      rubies[index] = {
        reading: group.reading + run.text,
        rect: unionRect([group.rect, run.rect]),
        size: Math.max(group.size, run.size),
        baseDirection,
      };
    }
  }
  return { body, rubies };
}

/**
 * 字が、ルビの親字か。ルビのすぐ横にあり、ルビと重なる長さが字の長さの 1/3 以上なら親字と見なす。
 * @param ruby ルビ
 * @param glyph 本文の字
 * @returns 親字なら true
 */
export function isRubyBase(ruby: RubyGroup, glyph: PlacedGlyph): boolean {
  if (glyph.size < ruby.size * RUBY_SIZE_RATIO) return false;
  if (!isBeside(ruby.rect, glyph.rect, glyph.size, ruby.baseDirection)) return false;
  const { rect } = glyph;
  const overlap =
    ruby.baseDirection === 'vertical'
      ? overlapLength(ruby.rect.y1, ruby.rect.y2, rect.y1, rect.y2) / (rect.y2 - rect.y1)
      : overlapLength(ruby.rect.x1, ruby.rect.x2, rect.x1, rect.x2) / (rect.x2 - rect.x1);
  return overlap >= BASE_OVERLAP_RATIO;
}
