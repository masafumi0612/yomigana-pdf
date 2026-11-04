// 部品どうし（リーダー → offscreen document → Worker）でやりとりするメッセージの形
import type { Result } from '@/result';
import type { RubySpan } from '@/text/annotate';
import type { Level } from '@/text/types';

/** 読みの問い合わせの宛先。offscreen document だけが受け取る */
export const OFFSCREEN_TARGET = 'offscreen';
/** 読みの問い合わせの種類 */
export const READ_TEXTS_TYPE = 'read-texts';

/** リーダーから offscreen document への、読みの問い合わせ */
export interface ReadingRequest {
  readonly target: typeof OFFSCREEN_TARGET;
  readonly type: typeof READ_TEXTS_TYPE;
  /** 読みを出す文（段落ごと） */
  readonly texts: readonly string[];
  /** 利用者が選んだ段階。この段階までに習う字にはルビを付けない */
  readonly level: Level;
  /** 利用者が直した読み・足した言葉（書き方と読み（平仮名）の組） */
  readonly userDictionary: readonly (readonly [string, string])[];
}

/**
 * 読みを出せなかった理由。リーダーは、どれでも「ルビを付けられませんでした」と出す。
 * - dictionary-unavailable：辞書を読み込めなかった
 * - analysis-failed：解析の途中で失敗した
 * - offscreen-unavailable：offscreen document を作れなかった
 * - no-response：返事がなかった（受け取る部品がない）
 * - timeout：待つ時間の上限を過ぎた
 * - invalid-response：返事の形がおかしかった
 */
export type ReadingError =
  | 'dictionary-unavailable'
  | 'analysis-failed'
  | 'offscreen-unavailable'
  | 'no-response'
  | 'timeout'
  | 'invalid-response';

/** 読みの問い合わせの返事。うまくいけば、文ごとのルビを付ける所の並び（texts と同じ順） */
export type ReadingResult = Result<readonly (readonly RubySpan[])[], ReadingError>;

/** offscreen document から Worker への問い合わせ */
export interface WorkerRequest {
  /** 返事と組にするための番号 */
  readonly id: number;
  readonly request: ReadingRequest;
}

/** Worker から offscreen document への返事 */
export interface WorkerResponse {
  /** 問い合わせの番号 */
  readonly id: number;
  readonly result: ReadingResult;
}
