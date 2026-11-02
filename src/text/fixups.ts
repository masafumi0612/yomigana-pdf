// kuromoji の語の並びの読みを直して、ルビに使う語の並びにする
import { readCounter } from './counters';
import readingFixesTsv from './data/reading-fixes.tsv?raw';
import { toHiragana } from './kana';
import { parseTsv } from './tsv';
import type { Token, UserDictionary, Word } from './types';

/** 読みを直す語が、前か後ろの語に求める条件 */
export interface FixCondition {
  /** 前の語を見るか、後ろの語を見るか */
  readonly side: 'before' | 'after';
  /** その語の品詞（例：助詞） */
  readonly pos: string;
}

/** 読みを直す表の1行 */
export interface ReadingFix {
  /** 正しい読み（平仮名） */
  readonly reading: string;
  /** 直す条件。いつも直すなら undefined */
  readonly condition: FixCondition | undefined;
}

/** 読みを直す表。書き方（例：令和）から直し方を引く。同じ書き方に、条件の違う行を並べてよい */
export type ReadingFixTable = ReadonlyMap<string, readonly ReadingFix[]>;

const FIX_COLUMNS = ['語', '読み', '条件', 'メモ'] as const;
/** 条件の書き方（例：後:助詞 は、すぐ後ろの語が助詞のとき） */
const CONDITION_PATTERN = /^(?<side>前|後):(?<pos>.+)$/u;

/** 語の並びの、ある位置から当てはまった語 */
interface Match {
  readonly word: Word;
  /** 当てはまった語の次の位置 */
  readonly end: number;
}

/**
 * 読みを直す表（TSV）を読む。
 * @param raw 表の文字列。列は 語・読み・条件・メモ
 * @returns 読みを直す表
 */
export function parseReadingFixes(raw: string): ReadingFixTable {
  const table = new Map<string, ReadingFix[]>();
  for (const row of parseTsv(raw, FIX_COLUMNS)) {
    const fixes = table.get(row.語) ?? [];
    fixes.push({ reading: row.読み, condition: parseCondition(row.条件) });
    table.set(row.語, fixes);
  }
  return table;
}

/** よく間違える語の表（data/reading-fixes.tsv） */
export const READING_FIXES: ReadingFixTable = parseReadingFixes(readingFixesTsv);

/**
 * kuromoji の語の並びの読みを直す。同じ位置では、次の順に先に当てはまったものを使う。
 * 1. 利用者の辞書（いくつかの語をつないだ書き方にも当てる。いちばん長いもの）
 * 2. 数＋助数詞（一本 → いっぽん）
 * 3. よく間違える語の表（いくつかの語をつないだ書き方にも当てる。いちばん長いもの）
 * 4. kuromoji の読みを平仮名にしたもの
 * @param tokens kuromoji の語の並び
 * @param userDictionary 利用者が直した読み・足した言葉
 * @param fixTable よく間違える語の表（テストで差しかえるため）
 * @returns 読みを直した語の並び。書き方をつなぐと、もとの語の並びの書き方と同じになる
 */
export function applyFixups(
  tokens: readonly Token[],
  userDictionary: UserDictionary,
  fixTable: ReadingFixTable = READING_FIXES,
): Word[] {
  const userMaxLength = maxKeyLength(userDictionary.keys());
  const fixMaxLength = maxKeyLength(fixTable.keys());
  const words: Word[] = [];
  let start = 0;
  while (start < tokens.length) {
    const match =
      findLongest(tokens, start, userMaxLength, 'user', (surface) => userDictionary.get(surface)) ??
      matchCounter(tokens, start) ??
      findLongest(
        tokens,
        start,
        fixMaxLength,
        'table',
        (surface, end) =>
          fixTable.get(surface)?.find((fix) => isConditionMet(fix.condition, tokens, start, end))
            ?.reading,
      ) ??
      fromKuromoji(tokens, start);
    words.push(match.word);
    start = match.end;
  }
  return words;
}

/**
 * 表の条件のセルを読む。
 * @param cell 条件のセル（例：後:助詞）。空なら条件なし
 * @returns 条件。条件なしなら undefined
 */
function parseCondition(cell: string): FixCondition | undefined {
  if (cell === '') {
    return undefined;
  }
  const groups = CONDITION_PATTERN.exec(cell)?.groups;
  if (groups?.side === undefined || groups.pos === undefined) {
    throw new Error(`読みを直す表の条件が読めない：${cell}`);
  }
  return { side: groups.side === '前' ? 'before' : 'after', pos: groups.pos };
}

/**
 * 辞書のいちばん長い書き方の長さを求める（つなぐ語を、どこまで見るかの上限）。
 * @param keys 辞書の書き方
 * @returns いちばん長い書き方の長さ。辞書が空なら 0
 */
function maxKeyLength(keys: Iterable<string>): number {
  return Math.max(0, ...[...keys].map((key) => key.length));
}

/**
 * start の語から、続く語の書き方をつないで辞書を引き、いちばん長く当てはまるものを探す。
 * @param tokens 語の並び
 * @param start 探し始める位置
 * @param maxLength つないだ書き方の長さの上限
 * @param source 当てはまったときの読みの出どころ
 * @param lookUp つないだ書き方と、その次の位置から、読みを引く。当てはまらなければ undefined
 * @returns いちばん長く当てはまった語。なければ undefined
 */
function findLongest(
  tokens: readonly Token[],
  start: number,
  maxLength: number,
  source: Word['source'],
  lookUp: (surface: string, end: number) => string | undefined,
): Match | undefined {
  let surface = '';
  let found: Match | undefined;
  // 語は1字以上なので、上限の字数より多くの語はつながない
  for (const [offset, token] of tokens.slice(start, start + maxLength).entries()) {
    surface += token.surface;
    if (surface.length > maxLength) {
      break;
    }
    const end = start + offset + 1;
    const reading = lookUp(surface, end);
    if (reading !== undefined) {
      found = { word: { surface, reading, source }, end };
    }
  }
  return found;
}

/**
 * 前か後ろの語が、表の条件に合うか。
 * @param condition 条件。undefined ならいつも合う
 * @param tokens 語の並び
 * @param start 直す語の最初の位置
 * @param end 直す語の次の位置
 * @returns 条件に合えば true
 */
function isConditionMet(
  condition: FixCondition | undefined,
  tokens: readonly Token[],
  start: number,
  end: number,
): boolean {
  if (condition === undefined) {
    return true;
  }
  const neighbor = condition.side === 'before' ? tokens[start - 1] : tokens[end];
  return neighbor?.pos === condition.pos;
}

/**
 * start から続く数の語（IPADIC は 二十三 を 二・十・三 に分ける）と、その次の助数詞を1語にまとめる。
 * @param tokens 語の並び
 * @param start 探し始める位置
 * @returns 数＋助数詞 の語。数で始まらない・助数詞が表にない・読みを決められないときは undefined
 */
function matchCounter(tokens: readonly Token[], start: number): Match | undefined {
  let end = start;
  while (isNumberToken(tokens[end])) {
    end += 1;
  }
  const counter = tokens[end];
  if (end === start || counter === undefined) {
    return undefined;
  }
  const numberText = tokens
    .slice(start, end)
    .map((token) => token.surface)
    .join('');
  const reading = readCounter(numberText, counter.surface);
  return reading === undefined
    ? undefined
    : {
        word: { surface: numberText + counter.surface, reading, source: 'counter' },
        end: end + 1,
      };
}

/**
 * 数の語か（IPADIC の品詞が 名詞・数。漢数字・算用数字・何 など）。
 * @param token 語。並びの外なら undefined
 * @returns 数の語なら true
 */
function isNumberToken(token: Token | undefined): boolean {
  return token?.pos === '名詞' && token.posDetails[0] === '数';
}

/**
 * kuromoji の読みを平仮名にして、1語のまま使う。
 * @param tokens 語の並び
 * @param start 語の位置
 * @returns その語
 */
function fromKuromoji(tokens: readonly Token[], start: number): Match {
  const token = tokens[start];
  return {
    word: {
      surface: token?.surface ?? '',
      reading: toHiragana(token?.reading ?? ''),
      source: 'kuromoji',
    },
    end: start + 1,
  };
}
