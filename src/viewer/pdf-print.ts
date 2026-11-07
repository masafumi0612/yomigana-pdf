// 作った PDF を、リーダーの中の見えない iframe に読み込んで、Chrome の印刷の画面を出す。
// iframe は同じ拡張の blob の URL なので、中の window の print を呼べる（Chrome の PDF の表示がその PDF を印刷する）。
// 印刷の画面が開いている間に iframe を消すと印刷できなくなるので、afterprint を受けたとき・次に印刷するとき・
// 別の PDF を開いたときに片づける。
import { createLogger } from '@/log';

/** iframe が PDF を読み込むのを待つ時間の上限（ミリ秒）。過ぎたら、印刷を呼べなかったことにする */
const LOAD_TIMEOUT_MS = 10_000;

const log = createLogger('viewer');

/** PDF を印刷する道具 */
export interface PdfPrinter {
  /**
   * PDF を見えない iframe に読み込み、印刷の画面を出す。
   * @param url PDF の URL（この拡張の blob の URL）
   * @returns 印刷を呼べたら true。読み込めない・呼べないときは false
   */
  print(url: string): Promise<boolean>;
  /** 印刷に使った iframe を片づける */
  dispose(): void;
}

/**
 * PDF を印刷する道具を作る。
 * @returns 印刷する道具
 */
export function createPdfPrinter(): PdfPrinter {
  let frame: HTMLIFrameElement | undefined;
  const dispose = (): void => {
    frame?.remove();
    frame = undefined;
  };

  return {
    async print(url) {
      dispose();
      const created = document.createElement('iframe');
      created.className = 'print-frame';
      created.tabIndex = -1;
      created.setAttribute('aria-hidden', 'true');
      frame = created;
      const isLoaded = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          resolve(false);
        }, LOAD_TIMEOUT_MS);
        created.addEventListener(
          'load',
          () => {
            clearTimeout(timer);
            resolve(true);
          },
          { once: true },
        );
        created.src = url;
        document.body.append(created);
      });
      // 待つ間に次の印刷や片づけがあったときは、この iframe はもう使わない
      if (frame !== created) return false;
      const view = created.contentWindow;
      if (!isLoaded || view === null) {
        dispose();
        return false;
      }
      try {
        view.addEventListener(
          'afterprint',
          () => {
            if (frame === created) dispose();
          },
          { once: true },
        );
        view.print();
        return true;
      } catch (error) {
        log.error('印刷の画面を出せませんでした', error);
        dispose();
        return false;
      }
    },
    dispose,
  };
}
