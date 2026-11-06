// ルビの右クリックから読みを直すときの、窓に出すものと、入れた読みの確かめ方。
// 直した読みは語ごとに保存するので、字ごとに付けたルビ（図鑑の 鑑 だけ）から開いても、語（図鑑）ごと直す。
import type { browser } from 'wxt/browser';

import type { Result } from '@/result';
import {
  MAX_READING_LENGTH,
  MAX_SURFACE_LENGTH,
  parseReading,
  parseSurface,
  type ReadingInputError,
  type SurfaceError,
  type UserDictionaryEntry,
} from '@/settings/dictionary-entry';
import type { RubyWord } from '@/text/annotate';

/** 文言のキー */
type MessageName = Parameters<typeof browser.i18n.getMessage>[0];

/** 読みを受け付けなかった理由の文言。決まりは設定の画面と同じなので、文言も同じものを使う */
const READING_ERRORS: Readonly<Record<ReadingInputError, MessageName>> = {
  empty: 'options_dict_readingEmpty',
  'not-hiragana': 'options_dict_readingNotHiragana',
  'too-long': 'options_dict_readingTooLong',
};

/** 読みを直す窓に出すもの */
export interface ReadingFixForm {
  /** 直す語（例：図鑑） */
  readonly surface: string;
  /** 欄に始めに入れておく、今の語全体の読み（例：ずかん） */
  readonly reading: string;
  /** 直した読みのある語なら true（「元に戻す」を出す） */
  readonly canRestore: boolean;
}

/** 読みを直すのを受け付けなかった理由。語そのものが入れられない（surface）か、読みが決まりに合わない（reading） */
export type ReadingFixError =
  | { readonly field: 'surface'; readonly error: SurfaceError }
  | { readonly field: 'reading'; readonly error: ReadingInputError };

/**
 * ルビのもとになった語から、読みを直す窓に出すものを作る。
 * @param word ルビのもとになった語
 * @returns 窓に出すもの
 */
export function readingFixFormOf(word: RubyWord): ReadingFixForm {
  return { surface: word.surface, reading: word.reading, canRestore: word.isUserFixed };
}

/**
 * 窓に入れた読みを確かめ、保存する1件にする。語は利用者が変えられないので、先に語を確かめる。
 * @param form 窓に出したもの
 * @param text 入れた読み
 * @returns 保存する1件か、受け付けなかった理由
 */
export function checkReadingFix(
  form: ReadingFixForm,
  text: string,
): Result<UserDictionaryEntry, ReadingFixError> {
  const surface = parseSurface(form.surface);
  if (!surface.ok) return { ok: false, error: { field: 'surface', error: surface.error } };
  const reading = parseReading(text);
  if (!reading.ok) return { ok: false, error: { field: 'reading', error: reading.error } };
  return { ok: true, value: { surface: surface.value, reading: reading.value } };
}

/**
 * 受け付けなかった理由の文言を引く。
 * @param error 受け付けなかった理由
 * @returns 文言のキーと、差し込む字の数
 */
export function fixErrorMessage(error: ReadingFixError): readonly [MessageName, string] {
  return error.field === 'surface'
    ? ['viewer_fix_surfaceInvalid', String(MAX_SURFACE_LENGTH)]
    : [READING_ERRORS[error.error], String(MAX_READING_LENGTH)];
}
