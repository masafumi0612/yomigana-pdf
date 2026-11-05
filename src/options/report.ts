// 不具合を知らせるときに貼る「報告用の情報」の文を作る。
// PDF の URL や本文は入れない（エラーの文に URL が混じっていても、ここでもう一度消す）
import { type ErrorRecord, stripUrls } from '@/log';

/** 版を出したいブラウザの名前。先にあるものを選ぶ（Edge なども Chromium の名前を持つため） */
const BRAND_ORDER = ['Google Chrome', 'Microsoft Edge', 'Chromium'];

/** User-Agent の中の Chrome の版 */
const UA_CHROME_VERSION = /Chrome\/([\d.]+)/u;

/** ブラウザの名前と版（`navigator.userAgentData` の `fullVersionList` の1つ） */
export interface BrandVersion {
  /** ブラウザの名前（例：Google Chrome） */
  readonly brand: string;
  /** 版（例：131.0.6778.85） */
  readonly version: string;
}

/** 報告用の情報に入れるもの */
export interface ReportInfo {
  /** 拡張の版 */
  readonly extensionVersion: string;
  /** ブラウザの名前と版（{@link browserVersionOf} で作ったもの） */
  readonly browserVersion: string;
  /** 直近のエラー（古い順） */
  readonly errors: readonly ErrorRecord[];
}

/**
 * ブラウザの名前と版を決める。
 * @param userAgent `navigator.userAgent`
 * @param brands `navigator.userAgentData` の `fullVersionList`。取れないときは undefined
 * @returns 例：「Google Chrome 131.0.6778.85」。わからないときは「不明」
 */
export function browserVersionOf(userAgent: string, brands?: readonly BrandVersion[]): string {
  for (const name of BRAND_ORDER) {
    const found = brands?.find(({ brand }) => brand === name);
    if (found !== undefined) {
      return `${found.brand} ${found.version}`;
    }
  }
  const matched = UA_CHROME_VERSION.exec(userAgent);
  return matched?.[1] === undefined ? '不明' : `Chrome ${matched[1]}`;
}

/**
 * 報告用の情報の文を作る。
 * @param info 拡張の版・ブラウザの版・直近のエラー
 * @returns 貼り付ける文（エラーは新しい順）
 */
export function buildReport(info: ReportInfo): string {
  const lines = [
    `よみがなPDF ${info.extensionVersion}`,
    `ブラウザ：${info.browserVersion}`,
    info.errors.length === 0 ? '直近のエラー：なし' : '直近のエラー（新しい順）：',
  ];
  for (const { time, scope, message } of [...info.errors].reverse()) {
    lines.push(`- ${time} [${scope}] ${stripUrls(message)}`);
  }
  return lines.join('\n');
}
