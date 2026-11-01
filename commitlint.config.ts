import { RuleConfigSeverity, type UserConfig } from '@commitlint/types';

// コミットメッセージの形：`種類(部品): 〜を追加`
// 種類と部品の名前は英語、説明は日本語で「〜を追加」「〜を修正」の形にする

/** かっこ内（scope）に使える部品の名前。リポジトリ全体の作業はかっこ内を付けない */
const SCOPES = ['viewer', 'ruby', 'text', 'pdf', 'settings', 'options', 'ci', 'deps', 'docs'];

/** 説明の終わりに使わない形（英語の「Add ○○」に合わせて「〜を追加」で終える） */
const VERB_ENDING = /(する|した|します|しました)$/u;

const config: UserConfig = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'subject-no-suru': ({ subject }) => [
          !VERB_ENDING.test(subject ?? ''),
          '説明は「〜を追加」「〜を修正」の形で書き、「〜する」「〜した」で終えない',
        ],
      },
    },
  ],
  rules: {
    'scope-enum': [RuleConfigSeverity.Error, 'always', SCOPES],
    // 大文字・小文字の決まりは日本語の説明に合わないので外す
    'subject-case': [RuleConfigSeverity.Disabled],
    // 日本語の本文は1行が長くなりやすいので、行の長さは確かめない
    'body-max-line-length': [RuleConfigSeverity.Disabled],
    'footer-max-line-length': [RuleConfigSeverity.Disabled],
    'subject-no-suru': [RuleConfigSeverity.Error, 'always'],
  },
};

export default config;
