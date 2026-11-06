import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { type Block, parseInlines, parseNotices } from '@/options/notices-markdown';

/** リポジトリの一番上のフォルダ */
const ROOT = join(import.meta.dirname, '../../..');

/** 拡張に同梱する文書 */
const NOTICES = readFileSync(join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');

/** 拡張に入る部品（package.json の dependencies） */
const DEPENDENCIES = Object.keys(
  (
    JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>;
    }
  ).dependencies,
);

/**
 * 見出しの文を取り出す。
 * @param blocks 文書のかたまり
 * @returns `##` の見出しの文
 */
function sectionTitles(blocks: readonly Block[]): string[] {
  return blocks
    .filter((block) => block.kind === 'heading' && block.level === 2)
    .map((block) =>
      block.kind === 'heading'
        ? block.inlines.map((inline) => ('text' in inline ? inline.text : inline.href)).join('')
        : '',
    );
}

describe('parseNotices', () => {
  it('見出しの行のとき、# の数と文の見出しになる', () => {
    expect(parseNotices('## PDF.js')).toEqual([
      { kind: 'heading', level: 2, inlines: [{ kind: 'text', text: 'PDF.js' }] },
    ]);
  });

  it('空の行で区切られていない行が続くとき、1つの段落にまとめる', () => {
    expect(parseNotices('1行目\n2行目\n\n次の段落')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '1行目\n2行目' }] },
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '次の段落' }] },
    ]);
  });

  it('段落のすぐ後ろに箇条書きが来たとき、段落と箇条書きに分ける', () => {
    expect(parseNotices('説明\n- 1つめ\n- 2つめ')).toEqual([
      { kind: 'paragraph', inlines: [{ kind: 'text', text: '説明' }] },
      {
        kind: 'list',
        items: [[{ kind: 'text', text: '1つめ' }], [{ kind: 'text', text: '2つめ' }]],
      },
    ]);
  });

  it('コードの枠のとき、中の行を見出しや箇条書きとして読まずにそのまま残す', () => {
    expect(parseNotices('```text\n# Copyright\n- item\n```')).toEqual([
      { kind: 'code', text: '# Copyright\n- item' },
    ]);
  });

  it('コードの枠が閉じていないとき、最後までをコードにする', () => {
    expect(parseNotices('```\nCopyright 2014')).toEqual([{ kind: 'code', text: 'Copyright 2014' }]);
  });

  it('表のとき、区切りの行を飛ばして見出しの行と中身の行に分ける', () => {
    expect(parseNotices('| 名前 | 中身 |\n| --- | --- |\n| `cmaps/` | CMap |')).toEqual([
      {
        kind: 'table',
        header: [[{ kind: 'text', text: '名前' }], [{ kind: 'text', text: '中身' }]],
        rows: [[[{ kind: 'code', text: 'cmaps/' }], [{ kind: 'text', text: 'CMap' }]]],
      },
    ]);
  });

  it('改行が CRLF のとき、LF と同じに読む', () => {
    expect(parseNotices('## A\r\n本文')).toEqual(parseNotices('## A\n本文'));
  });
});

describe('parseInlines', () => {
  it('`コード` と URL があるとき、文・コード・リンクに分ける', () => {
    expect(
      parseInlines('全文は `licenses/Apache-2.0.txt`、または https://example.com/a ）'),
    ).toEqual([
      { kind: 'text', text: '全文は ' },
      { kind: 'code', text: 'licenses/Apache-2.0.txt' },
      { kind: 'text', text: '、または ' },
      { kind: 'link', href: 'https://example.com/a' },
      { kind: 'text', text: ' ）' },
    ]);
  });

  it('URL のすぐ後ろに全角の句読点があるとき、句読点を URL に含めない', () => {
    expect(parseInlines('https://example.com、次')).toEqual([
      { kind: 'link', href: 'https://example.com' },
      { kind: 'text', text: '、次' },
    ]);
  });

  it('http・https でない書き方のとき、リンクにしない', () => {
    expect(parseInlines('javascript:alert(1)')).toEqual([
      { kind: 'text', text: 'javascript:alert(1)' },
    ]);
  });
});

describe('THIRD_PARTY_NOTICES.md', () => {
  const titles = sectionTitles(parseNotices(NOTICES));

  it.each(DEPENDENCIES)('拡張に入る部品 %s の場所が、見出しにある', (name) => {
    expect(titles.some((title) => title.includes(`（${name}）`))).toBe(true);
  });

  it.each(['PDF.js', 'kuromoji.js', 'IPADIC', 'Noto Serif JP'])(
    '%s の場所が、見出しにある',
    (name) => {
      expect(titles.some((title) => title.includes(name))).toBe(true);
    },
  );
});
