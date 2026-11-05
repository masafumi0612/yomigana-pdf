import type { JSX } from 'preact';
import { useState } from 'preact/hooks';
import { browser } from 'wxt/browser';

import { createLogger, getStoredErrors } from '@/log';

import { message } from './message';
import { type BrandVersion, browserVersionOf, buildReport } from './report';

const log = createLogger('options');

/** コピーした結果。押す前（idle）・コピーした（copied）・できなかった（failed） */
type CopyPhase = 'idle' | 'copied' | 'failed';

/** `navigator.userAgentData`（TypeScript の DOM の型にまだないので、使うところだけ） */
interface UserAgentData {
  getHighEntropyValues(hints: string[]): Promise<{ fullVersionList?: BrandVersion[] }>;
}

/**
 * ブラウザの名前と版を読む。細かい版が取れないときは User-Agent の版を使う。
 * @returns 例：「Google Chrome 131.0.6778.85」
 */
async function readBrowserVersion(): Promise<string> {
  const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
  const values = await data?.getHighEntropyValues(['fullVersionList']);
  return browserVersionOf(navigator.userAgent, values?.fullVersionList);
}

/**
 * 「報告用の情報をコピー」のボタン。拡張とブラウザの版、直近のエラーを、文にしてコピーする。
 * PDF の URL や本文は入れない。
 * @returns ボタンと、コピーしたことの知らせ
 */
export function ReportButton(): JSX.Element {
  const [phase, setPhase] = useState<CopyPhase>('idle');

  const copy = (): void => {
    Promise.all([readBrowserVersion(), getStoredErrors()])
      .then(([browserVersion, errors]) =>
        navigator.clipboard.writeText(
          buildReport({
            extensionVersion: browser.runtime.getManifest().version,
            browserVersion,
            errors,
          }),
        ),
      )
      .then(() => {
        setPhase('copied');
      })
      .catch((error: unknown) => {
        log.error('報告用の情報をコピーするのに失敗しました', error);
        setPhase('failed');
      });
  };

  return (
    <div class="report">
      <div class="row">
        <button type="button" class="button button-quiet" onClick={copy}>
          {message('options_about_copyReport')}
        </button>
        {/* 設定を戻すボタンの知らせ（role="status"）と分けるため、aria-live で読み上げる */}
        <span class={phase === 'failed' ? 'error' : 'saved'} aria-live="polite">
          {phase === 'copied' && message('options_about_copied')}
          {phase === 'failed' && message('options_about_copyFailed')}
        </span>
      </div>
      <p>{message('options_about_copyReportHint')}</p>
    </div>
  );
}
