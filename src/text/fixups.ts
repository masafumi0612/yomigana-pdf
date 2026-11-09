// kuromoji の語の並びの読みを直して、ルビに使う語の並びにする
import { readCounter } from './counters';
import readingFixesTsv from './data/reading-fixes.tsv?raw';
import { toHiragana } from './kana';
import { getKanjiInfo } from './kanji-data';
import { parseTsv } from './tsv';
import type { Token, UserDictionary, Word } from './types';

/** 読みを直す語が、前の語・後ろの語・その語そのものに求める条件 */
export interface FixCondition {
  /** 前の語を見るか、後ろの語を見るか、直す語そのものを見るか */
  readonly side: 'before' | 'after' | 'self';
  /**
   * 書き方。前なら直す語の直前までがこれで終わり、後ろなら直す語の直後からがこれで始まる
   * （いくつかの語にまたがってよい）。見ないなら undefined
   */
  readonly text: string | undefined;
  /** 書き方の、直す語から遠い側の端が、kuromoji の語の途中でもよいなら true */
  readonly isPartial: boolean;
  /**
   * すぐ隣の語（直す語そのものを見るときは、その語）の品詞と細かい分け方の頭
   * （例：['助詞']、['名詞', '接尾', '助数詞']）。見ないなら空
   */
  readonly pos: readonly string[];
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
/**
 * 条件の書き方。「前:」「後:」「語:」のあとに、「」で囲んだ書き方と品詞の、どちらか一方か両方を書く。
 * - 後:助詞：すぐ後ろの語が助詞
 * - 前:「時」名詞,接尾,助数詞：すぐ前の語が「時」で、品詞が 名詞・接尾・助数詞
 * - 後:「前」：後ろが「前」で始まり、そこで語が切れる（十分前 に当たり、十分前進 には当たらない）
 * - 後:「を占め…」：後ろが「を占め」で始まる。終わりの … は、語の途中で終わってよいこと（占める・占めた）
 * - 前:「…月」：前が「月」で終わる。頭の … は、語の途中から始まってよいこと（四月・毎月）
 * - 語:名詞,形容動詞語幹：直す語が kuromoji の1語のままで、品詞が 名詞・形容動詞語幹
 */
const CONDITION_PATTERN = /^(?<side>前|後|語):(?:「(?<text>[^「」]+)」)?(?<pos>[^「」]*)$/u;
/** 条件の向きの書き方から、向きを引く */
const SIDES: ReadonlyMap<string, FixCondition['side']> = new Map([
  ['前', 'before'],
  ['後', 'after'],
  ['語', 'self'],
]);
/** 書き方の端が語の途中でもよいことを表す印 */
const PARTIAL_MARK = '…';

/** 漢字だけの書き方 */
const ALL_KANJI = /^\p{Script=Han}+$/u;
/** 促音になりうる、つ・ち で終わる音 */
const TSU_CHI_END = /[つち]$/u;
/** 促音になりうる、く・き で終わる音 */
const KU_KI_END = /[くき]$/u;
/** か行の仮名で始まる読み */
const KA_ROW = /^[かきくけこ]/u;
/** か行・さ行・た行の仮名で始まる読み */
const KA_SA_TA_ROW = /^[かきくけこさしすせそたちつてと]/u;
/** は行の仮名を、半濁音（ぱ行）にする */
const SEMI_VOICED: ReadonlyMap<string, string> = new Map([
  ['は', 'ぱ'],
  ['ひ', 'ぴ'],
  ['ふ', 'ぷ'],
  ['へ', 'ぺ'],
  ['ほ', 'ぽ'],
]);

/** 語の並びの、ある位置から当てはまった語 */
interface Match {
  readonly word: Word;
  /** 当てはまった語の次の位置 */
  readonly end: number;
}

/**
 * 読みを直す表（TSV）を読む。同じ語に条件の違う行をいくつも並べてよく、上の行から順に見て、
 * 最初に条件に合った行の読みを使う。条件のない行はいつも合う（条件の書き方は CONDITION_PATTERN）。
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
 * 3. よく間違える語の表（いくつかの語をつないだ書き方にも当てる。いちばん長いもの。前後の語で読みを決める行もある）
 * 4. 読みの分からない字を含む漢字の続きに、常用漢字表の音を当てたもの（全問必答 → ぜんもんひっとう）
 * 5. kuromoji の読みを平仮名にしたもの
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
      matchGuess(tokens, start) ??
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
  const side = SIDES.get(groups?.side ?? '');
  const pos = groups?.pos === undefined || groups.pos === '' ? [] : groups.pos.split(',');
  const parsed = side === undefined ? undefined : parseConditionText(groups?.text, side);
  if (
    side === undefined ||
    parsed === undefined ||
    (parsed.text === undefined && pos.length === 0)
  ) {
    throw new Error(`読みを直す表の条件が読めない：${cell}`);
  }
  return { side, ...parsed, pos };
}

/**
 * 条件の「」の中の書き方を読む。直す語から遠い側の端の … は、語の途中でもよいことを表す。
 * @param raw 「」の中。書いていなければ undefined
 * @param side 条件の向き
 * @returns 書き方と、端が語の途中でもよいか。書き方の形が違うときは undefined
 */
function parseConditionText(
  raw: string | undefined,
  side: FixCondition['side'],
): Pick<FixCondition, 'text' | 'isPartial'> | undefined {
  if (raw === undefined) {
    return { text: undefined, isPartial: false };
  }
  const isPartial = side === 'before' ? raw.startsWith(PARTIAL_MARK) : raw.endsWith(PARTIAL_MARK);
  const text = isPartial ? raw.replace(PARTIAL_MARK, '') : raw;
  // 直す語そのものは書き方が決まっているので、書き方の条件は付けない
  return side === 'self' || text === '' || text.includes(PARTIAL_MARK)
    ? undefined
    : { text, isPartial };
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
 * 前の語・後ろの語・直す語そのものが、表の条件に合うか。
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
  if (condition.side === 'self') {
    return end - start === 1 && isPosMatch(tokens[start], condition.pos);
  }
  const neighbor = condition.side === 'before' ? tokens[start - 1] : tokens[end];
  return isPosMatch(neighbor, condition.pos) && isTextMatch(condition, tokens, start, end);
}

/**
 * 語の品詞が、条件の品詞と細かい分け方の頭に合うか。
 * @param token 語。並びの外なら undefined
 * @param pos 条件の品詞と細かい分け方の頭。空ならいつも合う
 * @returns 合えば true
 */
function isPosMatch(token: Token | undefined, pos: readonly string[]): boolean {
  const actual = token === undefined ? [] : [token.pos, ...token.posDetails];
  return pos.every((part, index) => actual[index] === part);
}

/**
 * 直す語の前か後ろに続く書き方が、条件の書き方に合うか。
 * @param condition 条件（前か後ろを見るもの）
 * @param tokens 語の並び
 * @param start 直す語の最初の位置
 * @param end 直す語の次の位置
 * @returns 合えば true。条件に書き方がなければ true
 */
function isTextMatch(
  condition: FixCondition,
  tokens: readonly Token[],
  start: number,
  end: number,
): boolean {
  const { text, side, isPartial } = condition;
  if (text === undefined) {
    return true;
  }
  const isBefore = side === 'before';
  const step = isBefore ? -1 : 1;
  let joined = '';
  // 条件の書き方の長さに届くまで、直す語に近い順に語をつなぐ
  for (let index = isBefore ? start - 1 : end; joined.length < text.length; index += step) {
    const surface = tokens[index]?.surface;
    if (surface === undefined) {
      break;
    }
    joined = isBefore ? surface + joined : joined + surface;
  }
  const isMatch = isBefore ? joined.endsWith(text) : joined.startsWith(text);
  // つないだ長さが書き方と同じなら、遠い側の端は語の切れ目にある
  return isMatch && (isPartial || joined.length === text.length);
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
 * 読みの分からない語を含む、漢字の語の続きに、常用漢字表の音を当てて1語にする。
 * kuromoji は辞書にない熟語を1字ずつに割り、読みの分かる字には訓を付ける（全問必答 → 問:とい・答:こたえ）。
 * 読みの分からない語がある続きだけを読み直すので、犬猫 や 朝昼晩 のような、字ごとに読みの分かる語の続きは変えない。
 * 読みの分からない語の字に音がない（常用漢字でない）ときは、当てられないので何もしない。
 * @param tokens 語の並び
 * @param start 探し始める位置
 * @returns 読みを当てた語。当てられないときは undefined
 */
function matchGuess(tokens: readonly Token[], start: number): Match | undefined {
  let end = start;
  while (isGuessable(tokens[end])) {
    end += 1;
  }
  const run = tokens.slice(start, end);
  if (!run.some((token) => token.reading === '')) {
    return undefined;
  }
  const readings = run.map(onReadingsOf);
  if (readings.includes(undefined)) {
    return undefined;
  }
  return {
    word: {
      surface: run.map((token) => token.surface).join(''),
      reading: joinOnReadings(readings.flatMap((reading) => reading ?? [])),
      source: 'guess',
    },
    end,
  };
}

/**
 * 読みを当てる続きに入れる語か（読みの分からない漢字の語か、漢字1字の語）。
 * @param token 語。並びの外なら undefined
 * @returns 入れるなら true
 */
function isGuessable(token: Token | undefined): boolean {
  if (token === undefined || !ALL_KANJI.test(token.surface)) {
    return false;
  }
  return token.reading === '' || Array.from(token.surface).length === 1;
}

/**
 * 語の字ごとの音を挙げる。音のない字（枠 など）は、語の読みが分かっていれば、その読みを使う。
 * @param token 漢字の語
 * @returns 字ごとの読み（平仮名）。当てられないときは undefined
 */
function onReadingsOf(token: Token): string[] | undefined {
  const readings: string[] = [];
  for (const char of Array.from(token.surface)) {
    const on = getKanjiInfo(char)?.on[0];
    if (on !== undefined) {
      readings.push(toHiragana(on));
    } else if (token.reading === '') {
      return undefined;
    } else {
      return [toHiragana(token.reading)];
    }
  }
  return readings;
}

/**
 * 字ごとの音をつなぐ。音の終わりが つ・ち・く・き で、次の音によっては促音にする（必答 → ひっとう、発表 → はっぴょう、学校 → がっこう）。
 * @param readings 字ごとの音（平仮名）
 * @returns つないだ読み
 */
function joinOnReadings(readings: readonly string[]): string {
  const parts = [...readings];
  for (const [index, current] of parts.entries()) {
    const next = parts[index + 1];
    if (next === undefined || current.length < 2) continue;
    const isTsuChi = TSU_CHI_END.test(current);
    const voiced = isTsuChi ? SEMI_VOICED.get(next.charAt(0)) : undefined;
    if (voiced !== undefined) parts[index + 1] = voiced + next.slice(1);
    if (
      voiced !== undefined ||
      (isTsuChi && KA_SA_TA_ROW.test(next)) ||
      (KU_KI_END.test(current) && KA_ROW.test(next))
    ) {
      parts[index] = `${current.slice(0, -1)}っ`;
    }
  }
  return parts.join('');
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
