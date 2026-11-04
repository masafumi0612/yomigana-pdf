// 受け取ったメッセージの形を確かめる。拡張を更新した直後は、古い版の部品と混ざることがあるため
import type { RubySpan } from '@/text/annotate';
import type { Level } from '@/text/types';

import {
  OFFSCREEN_TARGET,
  READ_TEXTS_TYPE,
  type ReadingError,
  type ReadingRequest,
  type ReadingResult,
  type WorkerRequest,
  type WorkerResponse,
} from './messages';

/** 受け取ってよい段階。漢字のデータを読み込まずに確かめるため、ここにも並べる（テストで揃っているか確かめる） */
export const LEVELS: readonly Level[] = [
  'all',
  'g1',
  'g2',
  'g3',
  'g4',
  'g5',
  'g6',
  'm1',
  'm2',
  'joyo',
];

const READING_ERRORS: readonly ReadingError[] = [
  'dictionary-unavailable',
  'analysis-failed',
  'offscreen-unavailable',
  'no-response',
  'timeout',
  'invalid-response',
];

/**
 * 読みの問い合わせの形をしているか。
 * @param value 受け取ったもの
 * @returns 読みの問い合わせの形なら true
 */
export function isReadingRequest(value: unknown): value is ReadingRequest {
  return (
    isRecord(value) &&
    value.target === OFFSCREEN_TARGET &&
    value.type === READ_TEXTS_TYPE &&
    isArrayOf(value.texts, isString) &&
    LEVELS.includes(value.level as Level) &&
    isArrayOf(value.userDictionary, isStringPair)
  );
}

/**
 * 読みの問い合わせの返事の形をしているか。
 * @param value 受け取ったもの
 * @returns 返事の形なら true
 */
export function isReadingResult(value: unknown): value is ReadingResult {
  if (!isRecord(value)) {
    return false;
  }
  if (value.ok === true) {
    return isArrayOf(value.value, (spans) => isArrayOf(spans, isRubySpan));
  }
  return value.ok === false && READING_ERRORS.includes(value.error as ReadingError);
}

/**
 * offscreen document から Worker への問い合わせの形をしているか。
 * @param value 受け取ったもの
 * @returns 問い合わせの形なら true
 */
export function isWorkerRequest(value: unknown): value is WorkerRequest {
  return isRecord(value) && isInteger(value.id) && isReadingRequest(value.request);
}

/**
 * Worker から offscreen document への返事の形をしているか。
 * @param value 受け取ったもの
 * @returns 返事の形なら true
 */
export function isWorkerResponse(value: unknown): value is WorkerResponse {
  return isRecord(value) && isInteger(value.id) && isReadingResult(value.result);
}

/**
 * ルビを付ける1か所の形をしているか。
 * @param value 確かめるもの
 * @returns 形が合っていれば true
 */
function isRubySpan(value: unknown): value is RubySpan {
  return (
    isRecord(value) &&
    isInteger(value.start) &&
    isInteger(value.end) &&
    value.start >= 0 &&
    value.start < value.end &&
    isString(value.ruby) &&
    typeof value.isAlways === 'boolean'
  );
}

/**
 * 中身を名前で引けるもの（配列でないオブジェクト）か。
 * @param value 確かめるもの
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * どの要素も条件に合う配列か。
 * @param value 確かめるもの
 * @param isItem 要素の条件
 * @returns 配列で、どの要素も条件に合えば true
 */
function isArrayOf<Item>(
  value: unknown,
  isItem: (item: unknown) => item is Item,
): value is readonly Item[] {
  return Array.isArray(value) && value.every((item: unknown) => isItem(item));
}

/**
 * 文字列か。
 * @param value 確かめるもの
 * @returns 文字列なら true
 */
function isString(value: unknown): value is string {
  return typeof value === 'string';
}

/**
 * 文字列2つの組か。
 * @param value 確かめるもの
 * @returns 文字列2つの配列なら true
 */
function isStringPair(value: unknown): value is readonly [string, string] {
  return isArrayOf(value, isString) && value.length === 2;
}

/**
 * 整数か。
 * @param value 確かめるもの
 * @returns 整数なら true
 */
function isInteger(value: unknown): value is number {
  return Number.isInteger(value);
}
