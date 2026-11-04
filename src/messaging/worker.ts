// offscreen document と、その中の Worker のあいだのやりとり
import { createLogger } from '@/log';
import type { ReadingService } from '@/text/reading-service';

import type { ReadingRequest, ReadingResult, WorkerRequest, WorkerResponse } from './messages';
import { withTimeout } from './timeout';
import { isWorkerRequest, isWorkerResponse } from './validate';

/** offscreen document から見た Worker（使うところだけ） */
export interface WorkerPort {
  /**
   * Worker に送る。
   * @param message 問い合わせ
   */
  postMessage(message: WorkerRequest): void;
  /**
   * Worker からの返事を受け取る。
   * @param type 受け取る種類
   * @param listener 受け取ったときに呼ぶ
   */
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
}

/** Worker に問い合わせるもの */
export interface WorkerClient {
  /**
   * Worker に読みを問い合わせる。
   * @param request 読みの問い合わせ
   * @returns 返事。上限の時間を過ぎたら timeout
   */
  request(request: ReadingRequest): Promise<ReadingResult>;
}

const log = createLogger('offscreen');
const workerLog = createLogger('worker');

/**
 * Worker に問い合わせるものを作る（offscreen document の側）。
 * @param port Worker
 * @param timeoutMs 返事を待つ時間の上限（ミリ秒）
 * @returns Worker に問い合わせるもの
 */
export function createWorkerClient(port: WorkerPort, timeoutMs: number): WorkerClient {
  const pending = new Map<number, (result: ReadingResult) => void>();
  let nextId = 1;
  port.addEventListener('message', (event) => {
    if (!isWorkerResponse(event.data)) {
      log.error('Worker から形のおかしい返事が来たので無視しました');
      return;
    }
    pending.get(event.data.id)?.(event.data.result);
    pending.delete(event.data.id);
  });
  return {
    async request(request) {
      const id = nextId;
      nextId += 1;
      const reply = new Promise<ReadingResult>((resolve) => {
        pending.set(id, resolve);
      });
      port.postMessage({ id, request });
      const result = await withTimeout(reply, timeoutMs);
      if (!result.ok) {
        pending.delete(id);
        log.error('Worker の返事が上限の時間までに来ませんでした');
        return result;
      }
      return result.value;
    },
  };
}

/**
 * Worker が問い合わせを受け取ったときに呼ぶ関数を作る（Worker の側）。
 * 形のおかしい問い合わせは、エラーを記録して無視する。
 * @param service 読みの問い合わせに答えるもの
 * @param post offscreen document に返事を送る
 * @returns message のイベントで呼ぶ関数
 */
export function createWorkerListener(
  service: ReadingService,
  post: (response: WorkerResponse) => void,
): (event: MessageEvent<unknown>) => void {
  return (event) => {
    if (!isWorkerRequest(event.data)) {
      workerLog.error('形のおかしい問い合わせが来たので無視しました');
      return;
    }
    const { id, request } = event.data;
    const options = { level: request.level, userDictionary: new Map(request.userDictionary) };
    // message のイベントは返事を待てないので、終わったら送る。read は失敗を戻り値で返す
    service
      .read(request.texts, options)
      .then((result) => {
        post({ id, result });
      })
      .catch((error: unknown) => {
        workerLog.error('読みの問い合わせに答えられませんでした', error);
      });
  };
}
