// Playwright が直接つながない相手（offscreen document と、その中の Worker）に、CDP で親を通して話す。
// 子には Target.attachToTarget（flatten: false）でつなぎ、Target.sendMessageToTarget で包んで送る。
// Worker は親のページの Target.setAutoAttach でしかつなげないので、ページにつないでから Worker を待つ
import type { BrowserContext, CDPSession, Page } from '@playwright/test';

/** CDP の返事を待つ時間の上限（ミリ秒） */
const CDP_TIMEOUT_MS = 5000;

/** CDP で話せる相手（ページや Worker） */
export interface CdpPeer {
  /**
   * 命令を送り、返事を待つ。
   * @param method 命令の名前（例：Runtime.getHeapUsage）
   * @param params 命令の引数
   * @returns 返事の result
   */
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /**
   * 知らせを受け取る。
   * @param method 知らせの名前（例：Target.attachedToTarget）
   * @param listener 受け取ったときに呼ぶ
   */
  on(method: string, listener: (params: unknown) => void): void;
}

/** CDP の相手の情報（Target.TargetInfo のうち、使うところ） */
export interface CdpTargetInfo {
  /** 相手の ID */
  readonly targetId: string;
  /** 種類（page・background_page・worker など。offscreen document は background_page） */
  readonly type: string;
  /** 相手の URL */
  readonly url: string;
}

/** 1つの JavaScript の実行環境（isolate）のメモリ（Runtime.getHeapUsage の返事） */
export interface HeapUsage {
  /** isolate の ID。同じプロセスの拡張の画面どうしは、同じ isolate を使う */
  readonly isolateId: string;
  /** JS のヒープで使っている大きさ（バイト） */
  readonly usedSize: number;
  /** DOM など、ブラウザの側のヒープで使っている大きさ（バイト） */
  readonly embedderHeapUsedSize: number;
  /** ArrayBuffer の中身の大きさ（バイト。辞書のデータはここに入る） */
  readonly backingStorageSize: number;
}

/** 子から届いたもの（CDP の返事か知らせ） */
interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { readonly message: string };
}

/** Target.receivedMessageFromTarget・Target.attachedToTarget の引数のうち、使うところ */
interface TargetEvent {
  readonly sessionId: string;
  readonly message?: string;
  readonly targetInfo?: CdpTargetInfo;
}

/**
 * 画面の CDP の口を、CdpPeer の形にする。この口から、ほかの相手につなぐ。
 * @param context 拡張を入れた Chromium の画面の集まり
 * @param page もとにする画面
 * @returns 画面の CDP の口
 */
export async function openCdp(context: BrowserContext, page: Page): Promise<CdpPeer> {
  const session = await context.newCDPSession(page);
  return {
    send: (method, params) => session.send(method as Parameters<CDPSession['send']>[0], params),
    on: (method, listener) => {
      session.on(method as Parameters<CDPSession['on']>[0], listener);
    },
  };
}

/**
 * 親を通して子と話すものを作る。
 * @param parent 親
 * @param sessionId 親から子につないだときの ID
 * @returns 子と話すもの
 */
function childOf(parent: CdpPeer, sessionId: string): CdpPeer {
  const pending = new Map<number, (message: CdpMessage) => void>();
  const listeners = new Map<string, ((params: unknown) => void)[]>();
  let nextId = 1;
  parent.on('Target.receivedMessageFromTarget', (params) => {
    const event = params as TargetEvent;
    if (event.sessionId !== sessionId || event.message === undefined) return;
    const message = JSON.parse(event.message) as CdpMessage;
    if (message.id !== undefined) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
      return;
    }
    for (const listener of listeners.get(message.method ?? '') ?? []) listener(message.params);
  });
  return {
    async send(method, params = {}) {
      const id = nextId;
      nextId += 1;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const reply = new Promise<CdpMessage>((resolve, reject) => {
        pending.set(id, resolve);
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`CDP の返事が来ない：${method}`));
        }, CDP_TIMEOUT_MS);
      });
      const sent = await Promise.all([
        reply,
        parent.send('Target.sendMessageToTarget', {
          sessionId,
          message: JSON.stringify({ id, method, params }),
        }),
      ]).finally(() => {
        clearTimeout(timer);
      });
      const [message] = sent;
      if (message.error !== undefined) {
        throw new Error(`CDP の命令が失敗した：${method}：${message.error.message}`);
      }
      return message.result;
    },
    on(method, listener) {
      listeners.set(method, [...(listeners.get(method) ?? []), listener]);
    },
  };
}

/**
 * ブラウザの中の相手を並べる。
 * @param peer どれかの相手
 * @returns 相手の情報
 */
export async function listTargets(peer: CdpPeer): Promise<CdpTargetInfo[]> {
  const result = (await peer.send('Target.getTargets')) as { targetInfos: CdpTargetInfo[] };
  return result.targetInfos;
}

/**
 * ページ（offscreen document も）につなぎ、その中の Worker にもつなげるようにする。
 * @param root 画面の CDP の口
 * @param targetId つなぐページの ID
 * @returns ページと話すものと、つないだ Worker（URL ごと。あとから増える）
 */
export async function attachPage(
  root: CdpPeer,
  targetId: string,
): Promise<{ page: CdpPeer; workers: Map<string, CdpPeer> }> {
  const { sessionId } = (await root.send('Target.attachToTarget', {
    targetId,
    flatten: false,
  })) as { sessionId: string };
  const page = childOf(root, sessionId);
  const workers = new Map<string, CdpPeer>();
  page.on('Target.attachedToTarget', (params) => {
    const event = params as TargetEvent;
    if (event.targetInfo?.type !== 'worker') return;
    workers.set(event.targetInfo.url, childOf(page, event.sessionId));
  });
  // 動いている Worker を止めずにつなぐ
  await page.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
  return { page, workers };
}

/**
 * 相手のメモリを測る。
 * @param peer ページか Worker
 * @returns isolate の ID とメモリ
 */
export async function heapUsage(peer: CdpPeer): Promise<HeapUsage> {
  const { id } = (await peer.send('Runtime.getIsolateId')) as { id: string };
  const usage = (await peer.send('Runtime.getHeapUsage')) as Partial<HeapUsage>;
  return {
    isolateId: id,
    usedSize: usage.usedSize ?? 0,
    embedderHeapUsedSize: usage.embedderHeapUsedSize ?? 0,
    backingStorageSize: usage.backingStorageSize ?? 0,
  };
}

/**
 * performance.measure で測った時間を引く。
 * @param peer ページか Worker
 * @param name performance.measure の名前
 * @returns 測った順の時間（ミリ秒）
 */
export async function measuredDurations(peer: CdpPeer, name: string): Promise<number[]> {
  const result = (await peer.send('Runtime.evaluate', {
    expression: `performance.getEntriesByName(${JSON.stringify(name)}, 'measure').map((entry) => entry.duration)`,
    returnByValue: true,
  })) as { result: { value?: number[] } };
  return result.result.value ?? [];
}
