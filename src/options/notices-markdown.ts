// 同梱した文書（THIRD_PARTY_NOTICES.md）を、「ライセンスと出典」の画面に出すために読む。
// 文書で使っている書き方（見出し・段落・箇条書き・表・コードの枠・`コード`・URL）だけを読み、
// ほかの書き方はそのままの文字として出す。HTML は作らず、画面の部品に渡す形にする

/** 文の中の1つの部分 */
export type Inline =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly text: string }
  | { readonly kind: 'link'; readonly href: string };

/** 見出し（`#`〜`###`） */
export interface HeadingBlock {
  readonly kind: 'heading';
  /** `#` の数 */
  readonly level: 1 | 2 | 3;
  readonly inlines: readonly Inline[];
}

/** 段落 */
export interface ParagraphBlock {
  readonly kind: 'paragraph';
  readonly inlines: readonly Inline[];
}

/** 箇条書き（`- `） */
export interface ListBlock {
  readonly kind: 'list';
  readonly items: readonly (readonly Inline[])[];
}

/** コードの枠（```）。著作権表示やライセンスの文を、そのまま出す */
export interface CodeBlock {
  readonly kind: 'code';
  readonly text: string;
}

/** 表（`| … |`） */
export interface TableBlock {
  readonly kind: 'table';
  readonly header: readonly (readonly Inline[])[];
  readonly rows: readonly (readonly (readonly Inline[])[])[];
}

/** 文書の1つのかたまり */
export type Block = HeadingBlock | ParagraphBlock | ListBlock | CodeBlock | TableBlock;

/** 見出しの行 */
const HEADING_LINE = /^(#{1,3}) (.*)$/u;

/** 箇条書きの行 */
const LIST_LINE = /^- (.*)$/u;

/** 表の区切りの行（`| --- | --- |`） */
const TABLE_RULE_LINE = /^\|[\s:|-]+\|$/u;

/** 文の中の `コード` と URL。URL は空白の前までとする（文書では URL の後ろに空白を置いている） */
const INLINE_PATTERN = /`([^`]+)`|(https?:\/\/[^\s`）、。]+)/gu;

/**
 * 文書を、画面に出すかたまりに分ける。
 * @param markdown 文書の文字
 * @returns かたまりの並び
 */
export function parseNotices(markdown: string): Block[] {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (line.trim() === '') {
      index += 1;
      continue;
    }
    if (line.startsWith('```')) {
      const end = lines.findIndex((next, at) => at > index && next.startsWith('```'));
      const last = end === -1 ? lines.length : end;
      blocks.push({ kind: 'code', text: lines.slice(index + 1, last).join('\n') });
      index = last + 1;
      continue;
    }
    const heading = HEADING_LINE.exec(line);
    if (heading !== null) {
      blocks.push({
        kind: 'heading',
        level: (heading[1]?.length ?? 1) as HeadingBlock['level'],
        inlines: parseInlines(heading[2] ?? ''),
      });
      index += 1;
      continue;
    }
    const group = takeWhile(lines, index, (next) => next.trim() !== '' && !isBlockStart(next));
    const first = group[0] ?? line;
    if (LIST_LINE.test(first)) {
      const items = takeWhile(lines, index, (next) => LIST_LINE.test(next));
      blocks.push({
        kind: 'list',
        items: items.map((item) => parseInlines(item.replace(LIST_LINE, '$1'))),
      });
      index += items.length;
      continue;
    }
    if (first.startsWith('|')) {
      const rows = takeWhile(lines, index, (next) => next.startsWith('|'));
      blocks.push(parseTable(rows));
      index += rows.length;
      continue;
    }
    blocks.push({ kind: 'paragraph', inlines: parseInlines(group.join('\n')) });
    index += group.length;
  }
  return blocks;
}

/**
 * 文の中の `コード` と URL を分ける。
 * @param text 1つのかたまりの文
 * @returns 文の部分の並び
 */
export function parseInlines(text: string): Inline[] {
  const inlines: Inline[] = [];
  let rest = 0;
  for (const match of text.matchAll(INLINE_PATTERN)) {
    if (match.index > rest) {
      inlines.push({ kind: 'text', text: text.slice(rest, match.index) });
    }
    const [whole, code, url] = match;
    inlines.push(
      code === undefined ? { kind: 'link', href: url ?? whole } : { kind: 'code', text: code },
    );
    rest = match.index + whole.length;
  }
  if (rest < text.length) {
    inlines.push({ kind: 'text', text: text.slice(rest) });
  }
  return inlines;
}

/**
 * ほかのかたまりが始まる行か（段落はここで切る）。
 * @param line 1行
 * @returns 見出し・コードの枠・箇条書き・表の行なら true
 */
function isBlockStart(line: string): boolean {
  return (
    HEADING_LINE.test(line) ||
    line.startsWith('```') ||
    LIST_LINE.test(line) ||
    line.startsWith('|')
  );
}

/**
 * 決まりに合う行が続くあいだ、行を取り出す。1行目は決まりに合わなくても取る。
 * @param lines すべての行
 * @param start 取り始める行
 * @param isTaken 続けて取る行なら true を返す関数
 * @returns 取り出した行
 */
function takeWhile(
  lines: readonly string[],
  start: number,
  isTaken: (line: string) => boolean,
): string[] {
  let end = start + 1;
  while (end < lines.length && isTaken(lines[end] ?? '')) {
    end += 1;
  }
  return lines.slice(start, end);
}

/**
 * 表の行を読む。2行目の区切りの行は飛ばす。
 * @param rows 表の行（`|` で始まる行）
 * @returns 表
 */
function parseTable(rows: readonly string[]): TableBlock {
  const cellsOf = (row: string): Inline[][] =>
    row
      .replace(/^\|/u, '')
      .replace(/\|$/u, '')
      .split('|')
      .map((cell) => parseInlines(cell.trim()));
  const [header = '', ...body] = rows;
  return {
    kind: 'table',
    header: cellsOf(header),
    rows: body.filter((row) => !TABLE_RULE_LINE.test(row)).map(cellsOf),
  };
}
