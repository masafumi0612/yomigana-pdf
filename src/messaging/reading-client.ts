// リーダーから読みを問い合わせる呼び出し口
import { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import type { Result } from '@/result';
import { DEFAULT_SETTINGS } from '@/settings/model';
import type { Level, UserDictionary } from '@/text/types';

import {
  OFFSCREEN_TARGET,
  READ_TEXTS_TYPE,
  type ReadingRequest,
  type ReadingResult,
} from './messages';
import { ensureOffscreenDocument, type OffscreenApi } from './offscreen';
import { READING_TIMEOUT_MS, withTimeout } from './timeout';
import { isReadingResult } from './validate';

/** 読みの問い合わせの細かい指定。どれも省ける */
export interface ReadingClientOptions {
  /** 利用者が選んだ段階。既定は設定の既定（DEFAULT_SETTINGS.level） */
  readonly level?: Level;
  /** 利用者が直した読み・足した言葉。既定は空 */
  readonly userDictionary?: UserDictionary;
  /** 返事を待つ時間の上限（ミリ秒）。既定は READING_TIMEOUT_MS */
  readonly timeoutMs?: number;
}

/** 読みを問い合わせるのに使う拡張の API */
export interface ReadingClientApi extends OffscreenApi {
  readonly runtime: Pick<typeof browser.runtime, 'getContexts' | 'getURL' | 'sendMessage'>;
}

const log = createLogger('reading-client');

/**
 * 文ごとに、ルビを付ける所を offscreen document に問い合わせる。offscreen document がなければ作る。
 * @param texts 文（段落ごと）
 * @param options 段階・利用者の辞書・待つ時間の上限
 * @param api 拡張の API（テストで差しかえるため）
 * @returns 文ごとのルビを付ける所（texts と同じ順）。出せなかったときはその理由（リーダーは「ルビを付けられませんでした」と出す）
 */
export async function requestReadings(
  texts: readonly string[],
  options: ReadingClientOptions = {},
  api: ReadingClientApi = browser,
): Promise<ReadingResult> {
  const ensured = await ensureOffscreenDocument(api);
  if (!ensured.ok) {
    return ensured;
  }
  const request: ReadingRequest = {
    target: OFFSCREEN_TARGET,
    type: READ_TEXTS_TYPE,
    texts,
    level: options.level ?? DEFAULT_SETTINGS.level,
    userDictionary: [...(options.userDictionary ?? new Map<string, string>())],
  };
  let reply: Result<unknown, 'timeout'>;
  try {
    reply = await withTimeout(
      api.runtime.sendMessage<ReadingRequest, unknown>(request),
      options.timeoutMs ?? READING_TIMEOUT_MS,
    );
  } catch (error) {
    log.error('読みの問い合わせに返事がありませんでした', error);
    return { ok: false, error: 'no-response' };
  }
  if (!reply.ok) {
    log.error('読みの問い合わせの返事が上限の時間までに来ませんでした');
    return reply;
  }
  if (!isReadingResult(reply.value)) {
    log.error('読みの問い合わせに形のおかしい返事が来たので無視しました');
    return { ok: false, error: 'invalid-response' };
  }
  return reply.value;
}
