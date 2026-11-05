import type { JSX } from 'preact';

/** ルビ付きの文の1つ分 */
export type RubyTextPart =
  /** ルビのない文字 */
  | { readonly kind: 'text'; readonly text: string }
  /** ルビを付ける字と、そのルビ */
  | { readonly kind: 'ruby'; readonly base: string; readonly ruby: string };

/** 文言の中のルビの書き方。「｜今日《きょう》」のように、ルビを付ける字を ｜ と 《》 ではさむ */
const RUBY_MARK = /｜([^｜《》]+)《([^｜《》]+)》/gu;

/**
 * 文言に書いたルビ（｜字《ルビ》）を読み、ルビのない文字とルビを付ける字に分ける。
 * 見本の文を、ルビの付け方ごと messages.json に置くために使う。
 * @param text ルビの書き方を含む文言（例：｜今日《きょう》は雨）
 * @returns 頭から順に並べたもの
 */
export function parseRubyText(text: string): RubyTextPart[] {
  const parts: RubyTextPart[] = [];
  let rest = 0;
  for (const match of text.matchAll(RUBY_MARK)) {
    const [whole, base = '', ruby = ''] = match;
    if (match.index > rest) parts.push({ kind: 'text', text: text.slice(rest, match.index) });
    parts.push({ kind: 'ruby', base, ruby });
    rest = match.index + whole.length;
  }
  if (rest < text.length) parts.push({ kind: 'text', text: text.slice(rest) });
  return parts;
}

/** ルビ付きの文に渡すもの */
export interface RubyTextProps {
  /** ルビの書き方（｜字《ルビ》）を含む文言 */
  readonly text: string;
}

/**
 * 文言に書いたルビを、本物の `<ruby>` にして出す。
 * @param props 出す文言
 * @param props.text ルビの書き方を含む文言
 * @returns ルビ付きの文
 */
export function RubyText({ text }: RubyTextProps): JSX.Element {
  return (
    <>
      {parseRubyText(text).map((part, index) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <ruby key={index}>
            {part.base}
            <rt>{part.ruby}</rt>
          </ruby>
        ),
      )}
    </>
  );
}
