import type { Browser } from 'wxt/browser';

type Rule = Browser.declarativeNetRequest.Rule;
type RuleCondition = Browser.declarativeNetRequest.RuleCondition;

/** 元の URL をリーダーに渡す印。DNR は URL を符号化できないので、元の URL をそのまま後ろに付ける */
export const REDIRECT_QUERY_PREFIX = '?DNR:';

/** PDF を返すときの種類 */
const PDF_CONTENT_TYPES = ['application/pdf', 'application/pdf;*'];

/** 種類の付け間違い。URL が .pdf のときだけ PDF として扱う */
const OCTET_STREAM_CONTENT_TYPES = ['application/octet-stream', 'application/octet-stream;*'];

/** 取り直せない POST の応答は移さない */
const EXCLUDED_METHODS: RuleCondition['excludedRequestMethods'] = ['post'];

/**
 * ページ全体・埋め込みの枠で開いた PDF を、リーダーに移すルールを作る。
 * 前にあるルールほど優先する（移さない決まりが、移す決まりより先）。
 *
 * @param viewerUrl - リーダーの URL（`chrome-extension://<ID>/viewer.html`）
 * @returns 登録するルール（id と優先度つき）
 */
export function buildRedirectRules(viewerUrl: string): Rule[] {
  const redirect = {
    type: 'redirect',
    redirect: { regexSubstitution: `${viewerUrl}${REDIRECT_QUERY_PREFIX}\\0` },
  } as const;
  const allow = { type: 'allow' } as const;
  const frames = ['main_frame', 'sub_frame'] as const;
  const attachment = [{ header: 'content-disposition', values: ['attachment*'] }];

  const ordered: { condition: RuleCondition; action: Rule['action'] }[] = [
    // 保存した PDF。利用者が「ファイルの URL へのアクセスを許可する」をオンにしたときだけ効く
    {
      condition: { regexFilter: '^file://.*\\.pdf$', resourceTypes: [...frames] },
      action: redirect,
    },
    // 埋め込みの枠の中の attachment は、ダウンロードの意図なので移さない（ページ全体は移す）
    {
      condition: {
        regexFilter: '^https?://',
        resourceTypes: ['sub_frame'],
        responseHeaders: attachment,
      },
      action: allow,
    },
    // 「=download」付きで attachment のリンクは、ダウンロードしたい意図なので移さない
    {
      condition: {
        urlFilter: '=download',
        resourceTypes: ['main_frame'],
        responseHeaders: attachment,
      },
      action: allow,
    },
    {
      condition: {
        regexFilter: '^https?://',
        excludedRequestMethods: EXCLUDED_METHODS,
        resourceTypes: [...frames],
        responseHeaders: [{ header: 'content-type', values: PDF_CONTENT_TYPES }],
      },
      action: redirect,
    },
    {
      condition: {
        regexFilter: '^https?://.*\\.pdf\\b.*$',
        excludedRequestMethods: EXCLUDED_METHODS,
        resourceTypes: [...frames],
        responseHeaders: [{ header: 'content-type', values: OCTET_STREAM_CONTENT_TYPES }],
      },
      action: redirect,
    },
  ];
  return ordered.map(({ condition, action }, index) => ({
    id: index + 1,
    priority: ordered.length - index,
    condition,
    action,
  }));
}
