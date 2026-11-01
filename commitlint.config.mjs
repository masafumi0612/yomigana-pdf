// コミットメッセージの形：`種類(部品): 〜を追加`
// 種類と部品の名前は英語、説明は日本語で「〜を追加」「〜を修正」の形にする

/** かっこ内（scope）に使える部品の名前。リポジトリ全体の作業はかっこ内を付けない */
const SCOPES = ['viewer', 'ruby', 'text', 'pdf', 'settings', 'options', 'ci', 'deps', 'docs'];

/** @type {import('@commitlint/types').UserConfig} */
// eslint-disable-next-line no-restricted-exports -- commitlint の設定ファイルは default export が決まり
export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        // 英語の「Add ○○」に合わせて「〜を追加」で終える。「〜する」「〜した」などで終えない
        'subject-no-suru': ({ subject }) => [
          !/(する|した|します|しました)$/u.test(subject ?? ''),
          '説明は「〜を追加」「〜を修正」の形で書き、「〜する」「〜した」で終えない',
        ],
      },
    },
  ],
  rules: {
    'scope-enum': [2, 'always', SCOPES],
    // 大文字・小文字の決まりは日本語の説明に合わないので外す
    'subject-case': [0],
    // 日本語の本文は1行が長くなりやすいので、行の長さは確かめない
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'subject-no-suru': [2, 'always'],
  },
};
