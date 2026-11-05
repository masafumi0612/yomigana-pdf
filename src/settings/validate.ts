// 保存してある設定の形を確かめる。ほかの版の拡張や、手で書き換えた値が混ざることがあるため
import { LEVELS } from '@/messaging/validate';
import type { Level } from '@/text/types';

import {
  DEFAULT_SETTINGS,
  RUBY_COLORS,
  RUBY_SIZE_RATIOS,
  type RubyColor,
  type RubySize,
  type RubyStyle,
  type RubyUnit,
  type Settings,
} from './model';

const RUBY_UNITS: readonly RubyUnit[] = ['unlearned-char'];

/**
 * 保存してある値から設定を作る。ない値・形の合わない値は、その項目だけ既定にする。
 * @param stored `storage.sync` から読んだ値
 * @returns 設定（throw しない）
 */
export function parseSettings(stored: Readonly<Record<string, unknown>>): Settings {
  return {
    autoRedirect: pick(stored.autoRedirect, isBoolean, DEFAULT_SETTINGS.autoRedirect),
    level: pick(stored.level, isLevel, DEFAULT_SETTINGS.level),
    rubyUnit: pick(stored.rubyUnit, isRubyUnit, DEFAULT_SETTINGS.rubyUnit),
    rubyStyle: parseRubyStyle(stored.rubyStyle),
  };
}

/**
 * ルビの見た目を作る。中の項目ごとに、形の合わないものだけ既定にする。
 * @param value 保存してある値
 * @returns ルビの見た目
 */
function parseRubyStyle(value: unknown): RubyStyle {
  const fallback = DEFAULT_SETTINGS.rubyStyle;
  if (!isRecord(value)) {
    return fallback;
  }
  return {
    size: pick(value.size, isRubySize, fallback.size),
    color: pick(value.color, isRubyColor, fallback.color),
    hasBand: pick(value.hasBand, isBoolean, fallback.hasBand),
  };
}

/**
 * 条件に合えばその値、合わなければ既定を返す。
 * @param value 確かめるもの
 * @param isValid 条件
 * @param fallback 既定
 * @returns 条件に合った値か既定
 */
function pick<Value>(
  value: unknown,
  isValid: (value: unknown) => value is Value,
  fallback: Value,
): Value {
  return isValid(value) ? value : fallback;
}

/**
 * 段階か。
 * @param value 確かめるもの
 * @returns 段階なら true
 */
function isLevel(value: unknown): value is Level {
  return LEVELS.includes(value as Level);
}

/**
 * ルビを付ける単位か。
 * @param value 確かめるもの
 * @returns 単位なら true
 */
function isRubyUnit(value: unknown): value is RubyUnit {
  return RUBY_UNITS.includes(value as RubyUnit);
}

/**
 * ルビの字の大きさか。
 * @param value 確かめるもの
 * @returns 大きさなら true
 */
function isRubySize(value: unknown): value is RubySize {
  return typeof value === 'string' && Object.hasOwn(RUBY_SIZE_RATIOS, value);
}

/**
 * ルビの色か。
 * @param value 確かめるもの
 * @returns 色なら true
 */
function isRubyColor(value: unknown): value is RubyColor {
  return typeof value === 'string' && Object.hasOwn(RUBY_COLORS, value);
}

/**
 * 真偽値か。
 * @param value 確かめるもの
 * @returns 真偽値なら true
 */
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

/**
 * 中身を名前で引けるもの（配列でないオブジェクト）か。
 * @param value 確かめるもの
 * @returns オブジェクトなら true
 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
