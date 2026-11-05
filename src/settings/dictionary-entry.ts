// 直した読み（利用者の辞書）の1件の形と決まり。保存の処理と設定の画面の両方から使う
import type { Result } from '@/result';
import type { UserDictionary } from '@/text/types';

/** 言葉の長さの上限（字）。人の名前や短い言葉を入れる欄なので、長い文は入れない */
export const MAX_SURFACE_LENGTH = 20;

/** 読みの長さの上限（字） */
export const MAX_READING_LENGTH = 40;

/** 漢字（々 を含む）。ルビは漢字にだけ付くので、言葉には漢字が要る */
const KANJI = /[\p{Script=Han}々]/u;

/** 読みに使える字（平仮名と長音） */
const HIRAGANA_ONLY = /^[ぁ-ゖー]+$/u;

/** 字の数を数えるもの。2つの番号で表す字（𠮟）や、濁点を分けて書いた字も1字と数える */
const graphemes = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 直した読みの1件 */
export interface UserDictionaryEntry {
  /** 言葉（例：小鳥遊）。PDF の文と同じく NFKC で形をそろえたもの */
  readonly surface: string;
  /** 読み（平仮名。例：たかなし） */
  readonly reading: string;
}

/** 言葉を受け付けなかった理由。空（empty）・長すぎる（too-long）・漢字がない（no-kanji） */
export type SurfaceError = 'empty' | 'too-long' | 'no-kanji';

/** 読みを受け付けなかった理由。空（empty）・平仮名でない（not-hiragana）・長すぎる（too-long） */
export type ReadingInputError = 'empty' | 'not-hiragana' | 'too-long';

/**
 * 入れられた言葉を確かめ、保存する形にする。前後の空白は除き、NFKC で形をそろえる。
 * @param text 入れられた言葉
 * @returns 保存する言葉か、受け付けなかった理由
 */
export function parseSurface(text: string): Result<string, SurfaceError> {
  const surface = text.trim().normalize('NFKC');
  if (surface === '') {
    return { ok: false, error: 'empty' };
  }
  if (charCount(surface) > MAX_SURFACE_LENGTH) {
    return { ok: false, error: 'too-long' };
  }
  if (!KANJI.test(surface)) {
    return { ok: false, error: 'no-kanji' };
  }
  return { ok: true, value: surface };
}

/**
 * 入れられた読みを確かめる。前後の空白は除く。
 * @param text 入れられた読み
 * @returns 保存する読みか、受け付けなかった理由
 */
export function parseReading(text: string): Result<string, ReadingInputError> {
  const reading = text.trim();
  if (reading === '') {
    return { ok: false, error: 'empty' };
  }
  if (!HIRAGANA_ONLY.test(reading)) {
    return { ok: false, error: 'not-hiragana' };
  }
  if (charCount(reading) > MAX_READING_LENGTH) {
    return { ok: false, error: 'too-long' };
  }
  return { ok: true, value: reading };
}

/**
 * 保存してあった1件が、今の決まりに合うか。手で書き換えた値や、壊れた値をはじくため。
 * @param value 保存してあった値（言葉と読みの組のつもり）
 * @returns 決まりに合えば、その1件。合わなければ undefined
 */
export function toEntry(value: unknown): UserDictionaryEntry | undefined {
  if (!Array.isArray(value) || value.length !== 2) {
    return undefined;
  }
  const [surface, reading] = value as unknown[];
  if (typeof surface !== 'string' || typeof reading !== 'string') {
    return undefined;
  }
  const parsedSurface = parseSurface(surface);
  const parsedReading = parseReading(reading);
  if (!parsedSurface.ok || !parsedReading.ok || parsedSurface.value !== surface) {
    return undefined;
  }
  return reading === parsedReading.value ? { surface, reading } : undefined;
}

/**
 * 直した読みの並びを、読みの処理に渡す形にする。
 * @param entries 直した読み
 * @returns 言葉から読みを引く表
 */
export function toUserDictionary(entries: readonly UserDictionaryEntry[]): UserDictionary {
  return new Map(entries.map(({ surface, reading }) => [surface, reading]));
}

/**
 * 字の数を数える。
 * @param text 文字列
 * @returns 字（書記素）の数
 */
function charCount(text: string): number {
  return [...graphemes.segment(text)].length;
}
