// offscreen document（1つだけ）を用意し、読みの問い合わせを中の Worker に渡す
import type { browser } from 'wxt/browser';

import { createLogger } from '@/log';
import type { Result } from '@/result';

import { OFFSCREEN_TARGET, type ReadingResult } from './messages';
import { isReadingRequest } from './validate';
import type { WorkerClient } from './worker';

/** offscreen document のページ（WXT が src/entrypoints/offscreen/ から作る） */
export const OFFSCREEN_PATH = '/offscreen.html';
/** offscreen document を作る理由（Chrome の決まりで、利用者には見えない） */
const OFFSCREEN_JUSTIFICATION =
  'Load the Japanese dictionary once in a Web Worker and answer reading requests from all tabs.';

/** offscreen document を用意するのに使う拡張の API */
export interface OffscreenApi {
  readonly runtime: Pick<typeof browser.runtime, 'getContexts' | 'getURL'>;
  readonly offscreen: Pick<typeof browser.offscreen, 'createDocument'>;
}

const log = createLogger('offscreen');
let creating: Promise<void> | undefined;

/**
 * offscreen document がなければ作る。いくつものタブから同時に呼んでも、1つだけ作る。
 * @param api 拡張の API
 * @returns 用意できたか。作れなかったときは offscreen-unavailable
 */
export async function ensureOffscreenDocument(
  api: OffscreenApi,
): Promise<Result<undefined, 'offscreen-unavailable'>> {
  try {
    if (!(await hasOffscreenDocument(api))) {
      creating ??= api.offscreen
        .createDocument({
          url: OFFSCREEN_PATH,
          reasons: ['WORKERS'],
          justification: OFFSCREEN_JUSTIFICATION,
        })
        .finally(() => {
          creating = undefined;
        });
      await creating;
    }
    return { ok: true, value: undefined };
  } catch (error) {
    // ほかのタブが先に作ると「1つしか作れない」で失敗するので、できているかを確かめ直す
    if (await hasOffscreenDocument(api).catch(() => false)) {
      return { ok: true, value: undefined };
    }
    log.error('offscreen document を作れませんでした', error);
    return { ok: false, error: 'offscreen-unavailable' };
  }
}

/**
 * offscreen document が読みの問い合わせを受け取ったときに呼ぶ関数を作る。
 * 宛先が offscreen でないメッセージは受け取らない。形のおかしい問い合わせは、エラーを記録して無視する。
 * @param client Worker に問い合わせるもの
 * @returns runtime.onMessage に渡す関数。返事をあとで送るときは true を返す（Chrome の決まり）
 */
export function createOffscreenListener(
  client: WorkerClient,
): (
  message: unknown,
  sender: unknown,
  sendResponse: (response: ReadingResult) => void,
) => true | undefined {
  return (message, _sender, sendResponse) => {
    if (!isForOffscreen(message)) {
      return undefined;
    }
    if (!isReadingRequest(message)) {
      log.error('形のおかしい問い合わせが来たので無視しました');
      return undefined;
    }
    // onMessage は返事を待てないので、Worker の返事が来たら送る。request は失敗を戻り値で返す
    client
      .request(message)
      .then(sendResponse)
      .catch((error: unknown) => {
        log.error('読みの問い合わせに答えられませんでした', error);
      });
    return true;
  };
}

/**
 * offscreen document があるか。
 * @param api 拡張の API
 * @returns あれば true
 */
async function hasOffscreenDocument(api: OffscreenApi): Promise<boolean> {
  const contexts = await api.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [api.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

/**
 * offscreen 宛てのメッセージか。
 * @param message 受け取ったもの
 * @returns 宛先が offscreen なら true
 */
function isForOffscreen(message: unknown): boolean {
  return typeof message === 'object' && message !== null && 'target' in message
    ? message.target === OFFSCREEN_TARGET
    : false;
}
