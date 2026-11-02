// 1語の読み（平仮名）を、字ごとの読みに分ける（図鑑/ずかん → 図:ず＋鑑:かん）。
// 試作 furigana-spike の src/poc/reading-split.ts の方式を移したもの。習ったかどうか（段階）は見ない
import { FUHYO_WORDS, type FuhyoWord, getKanjiInfo, isJoyo } from './kanji-data';
import type { Seg, SplitResult, Word } from './types';

/** 訓の送り仮名を落とした形（語る → 物語の「かた」）の点。送り仮名ありの形より少しだけ選ばれにくくする */
const COST_KUN_STEM = 0.1;
/** 訓の連用形（語る → かたり、受ける → うけ）の点 */
const COST_KUN_RENYOU = 0.2;
/** 送り仮名を多めに送る許容の形（表わす ＝ 表:あら＋わす）の点。本則の送り方より選ばれにくくする */
const COST_OKURI_KYOYO = 0.3;
/** 送り仮名の許容で、語幹の終わりを仮名で書いてよい字の数（表わす・行なう・現われる は1〜2字） */
const MAX_OKURI_KYOYO_KANA = 2;
/** カ変「来る」の活用（来ます き、来ない こ）の点。表の訓「く.る」から作れないので別に足す */
const COST_KURU = 0.2;
/** 連濁（手紙 てがみ、雨雲 あまぐも）の点 */
const COST_RENDAKU = 1;
/**
 * 語の頭の連濁の点。kuromoji は接尾の語を分けて読みを付ける（ごみ袋 → ごみ／袋 ぶくろ）が、
 * Word には品詞がなく前の語に続くか分からないので、語の頭でも連濁を認め、語の中より高い点にする
 * （試作は品詞が接尾のときだけ認めていた）
 */
const COST_RENDAKU_WORD_START = 2;
/** 半濁音化（ん・っ の後の は行 → ぱ行。発表 はっぴょう、三本 さんぼん は連濁）の点 */
const COST_HANDAKU = 1;
/** 連声（ん の後の あ行 → な行。因縁 いんねん）の点。連濁よりまれなので高めにする */
const COST_RENJO = 1.5;
/** 促音化（学校 がっこう の「がく → がっ」）の点 */
const COST_SOKUON = 1;
/** 付表の語の点。負にして、字ごとの読みでも合うときは付表の語（熟字訓）を先に選ぶ */
const COST_FUHYO = -1;
/** 「ヶ」を が・こ と読む（霞ヶ関・八ヶ岳）ときの点。か と読むとき（一ヶ月）は 0 */
const COST_KE = 0.5;
/**
 * 表外字1字あたりの点。どんな読みでも取れるので、常用の読みどうしで合う分け方より高くし、
 * 表外字に読みを寄せる分け方が選ばれないようにする
 */
const COST_HYOGAI_PER_CHAR = 2;
/** 表外字1字が取れる読みの仮名の数の上限（林檎 → 檎:ご、霞 → かすみ） */
const MAX_KANA_PER_HYOGAI = 4;
/**
 * 途中の位置（何字目・読みの何文字目）ごとに残す分け方の数。点の低い順にこの数だけ残す。
 * 長い語で分け方の数がふくらむのを抑え、同じ点の分け方（表外字の切れ目が決まらない）を見分けるのに使う
 */
const MAX_SOLUTIONS = 12;
/** 点が同じとみなす差。小数の足し算の誤差を吸う */
const COST_EPSILON = 1e-9;

/** 漢字（CJK 統合漢字・拡張 A・互換漢字・拡張 B 以降）1字 */
const KANJI = /^[㐀-鿿豈-﫿\u{20000}-\u{2FFFF}]$/u;
/** 仮名1字（長音の記号を含む） */
const KANA = /^[ぁ-ゖァ-ヺー]$/u;
/** 前の字の読みを繰り返す記号（人々 ひとびと） */
const REPEAT_MARK = /^[々ゝ]$/u;
/** が・こ とも読む「ヶ」 */
const KE = /^[ヶヵケ]$/u;
/** 「ヶ」の読みが が・こ のとき */
const KE_VOICED = /^[がこ]/u;
/** 語の途中で字の読みが始まれない仮名。表外字の読みの頭に来させない */
const CANNOT_START = /^[ぁぃぅぇぉっゃゅょゎんー]/u;
/** 促音化する読みの終わり（がく → がっ） */
const SOKUON_ENDING = /[きくちつ]$/u;
/** 促音化のあとに続く仮名。か・さ・た・ぱ 行のときだけ促音になる */
const SOKUON_NEXT = /^[かきくけこさしすせそたちつてとぱぴぷぺぽ]/u;
/** 連濁で濁る仮名 */
const RENDAKU: ReadonlyMap<string, string> = new Map([
  ['か', 'が'],
  ['き', 'ぎ'],
  ['く', 'ぐ'],
  ['け', 'げ'],
  ['こ', 'ご'],
  ['さ', 'ざ'],
  ['し', 'じ'],
  ['す', 'ず'],
  ['せ', 'ぜ'],
  ['そ', 'ぞ'],
  ['た', 'だ'],
  // ぢ・づ は じ・ず にそろえて比べる（手綱 たづな）
  ['ち', 'じ'],
  ['つ', 'ず'],
  ['て', 'で'],
  ['と', 'ど'],
  ['は', 'ば'],
  ['ひ', 'び'],
  ['ふ', 'ぶ'],
  ['へ', 'べ'],
  ['ほ', 'ぼ'],
]);
/** 半濁音化する仮名 */
const HANDAKU: ReadonlyMap<string, string> = new Map([
  ['は', 'ぱ'],
  ['ひ', 'ぴ'],
  ['ふ', 'ぷ'],
  ['へ', 'ぺ'],
  ['ほ', 'ぽ'],
]);
/** 連声で変わる仮名 */
const RENJO: ReadonlyMap<string, string> = new Map([
  ['あ', 'な'],
  ['い', 'に'],
  ['う', 'ぬ'],
  ['え', 'ね'],
  ['お', 'の'],
]);
/** 訓の終わりの仮名を、連用形（い段）に変える（語る かたる → かたり） */
const RENYOU_ENDING: ReadonlyMap<string, string> = new Map([
  ['う', 'い'],
  ['く', 'き'],
  ['ぐ', 'ぎ'],
  ['す', 'し'],
  ['つ', 'ち'],
  ['ぬ', 'に'],
  ['ぶ', 'び'],
  ['む', 'み'],
  ['る', 'り'],
]);
/** 表の訓から作れない活用の読み（カ変「来る」） */
const EXTRA_READINGS: ReadonlyMap<string, readonly string[]> = new Map([['来', ['き', 'こ']]]);

/** 漢字1字が取れる読みの1つ */
interface Candidate {
  /** 読み（仮名をそろえた形） */
  readonly kana: string;
  /** 点。低いほど選ばれやすい */
  readonly cost: number;
  /** この読みのすぐ後に、書き方で続かなければならない仮名（送り仮名の許容：表わす の「わ」）。なければ空 */
  readonly tail: string;
}

/** 付表の語のうち、字の並びと照らす部分（差し支える → 差し支／さしつか） */
interface FuhyoUnit {
  /** 前後の仮名を外した書き方 */
  readonly text: string;
  /** text の字の数 */
  readonly length: number;
  /** text の読み（仮名をそろえた形） */
  readonly reading: string;
}

/** 語の書き方の一部と、読みの一部の対応 */
interface Piece {
  /** 書き方の字の位置（start 以上 end 未満） */
  readonly start: number;
  readonly end: number;
  /** 読みの位置（readingStart 以上 readingEnd 未満） */
  readonly readingStart: number;
  readonly readingEnd: number;
  /**
   * kanji：常用漢字1字、kana：仮名、fuhyo：付表の語、hyogai：表外字の続き、
   * undecided：表外字の切れ目が決まらない部分（結果を作るときだけ使う）
   */
  readonly type: 'kanji' | 'kana' | 'fuhyo' | 'hyogai' | 'undecided';
  readonly cost: number;
}

/** 語の頭から終わりまでの分け方の1つ */
interface Solution {
  readonly cost: number;
  readonly pieces: readonly Piece[];
}

/** 1語を探すときの入力と、途中の結果の覚え書き */
interface Search {
  /** 書き方の字（サロゲートペアの字も1字） */
  readonly chars: readonly string[];
  /** 読み（仮名をそろえた形） */
  readonly reading: string;
  /** 位置ごとの、そこから終わりまでの分け方（点の低い順） */
  readonly memo: Map<number, readonly Solution[]>;
}

/** 書き方と読みの両端で、同じ仮名が続く数 */
interface KanaEdges {
  readonly head: number;
  readonly tail: number;
}

const EMPTY_SOLUTION: Solution = { cost: 0, pieces: [] };
const candidateCache = new Map<string, readonly Candidate[]>();
const fuhyoUnits: readonly FuhyoUnit[] = FUHYO_WORDS.map(toFuhyoUnit);

/**
 * 語の読みを、字ごとの読みに分ける。
 *
 * 付表の語（今日 きょう）は語全体を1つの固まりにする。それ以外は、字の並びと読みを左から合わせ、
 * 常用漢字表の音訓（音の変化と送り仮名を含む）でいちばん点の低い分け方を選ぶ。
 * 合わなければ、表外の読み・当て字として語全体を1つの固まりにする。
 *
 * @param word 読みの手直しのあとの1語
 * @returns 字ごとに分けた結果。segs の base をつなぐと word.surface になる
 */
export function splitReading(word: Word): SplitResult {
  const chars = Array.from(word.surface);
  if (!chars.some((char) => KANJI.test(char) || REPEAT_MARK.test(char))) {
    return { word, segs: [{ kind: 'kana', base: word.surface }] };
  }
  if (word.reading === '') {
    return { word, segs: [{ kind: 'block', base: word.surface, reading: '', why: 'unknown' }] };
  }
  const reading = foldKana(word.reading);
  const solutions = solve({ chars, reading, memo: new Map() }, 0, 0);
  const [best] = solutions;
  if (best === undefined) return { word, segs: irregularSegs(chars, reading, word.reading) };
  return { word, segs: toSegs(chars, word.reading, best, solutions) };
}

/**
 * 仮名を比べられる形にそろえる。片仮名は平仮名に、ぢ・づ は じ・ず に、小さい ゖ・ゕ は か にする。
 * 1字は1字のまま変えるので、そろえたあとの位置で元の読みを切り出せる。
 * @param text 仮名を含む文字列
 * @returns そろえた文字列
 */
function foldKana(text: string): string {
  return text
    .replaceAll(/[ァ-ヶ]/gu, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .replaceAll('ぢ', 'じ')
    .replaceAll('づ', 'ず')
    .replaceAll(/[ゖゕ]/gu, 'か');
}

/**
 * 表外字（常用漢字でない漢字）か。
 * @param char 1字
 * @returns 表外字なら true
 */
function isHyogaiKanji(char: string): boolean {
  return KANJI.test(char) && !isJoyo(char);
}

/**
 * 語の両端で、書き方の仮名と読みの仮名が同じまま続く数を数える。真ん中に読みが1字は残るようにする。
 * @param chars 書き方の字
 * @param reading 読み（仮名をそろえた形）
 * @returns 頭と終わりで同じ仮名が続く数
 */
function kanaEdges(chars: readonly string[], reading: string): KanaEdges {
  let head = 0;
  for (const char of chars) {
    if (head + 1 >= reading.length || !isSameKana(char, reading.charAt(head))) break;
    head++;
  }
  let tail = 0;
  for (const char of chars.slice(head).toReversed()) {
    const rest = reading.length - head - tail;
    if (rest <= 1 || !isSameKana(char, reading.charAt(rest - 1))) break;
    tail++;
  }
  return { head, tail };
}

/**
 * 書き方の1字が、読みの仮名1字と同じ仮名か。
 * @param char 書き方の1字
 * @param kana 読みの仮名1字（仮名をそろえた形）
 * @returns 同じ仮名なら true
 */
function isSameKana(char: string, kana: string): boolean {
  return KANA.test(char) && foldKana(char) === kana;
}

/**
 * 付表の語から、前後の仮名を外した照らし合わせ用の形を作る（差し支える → 差し支／さしつか、お神酒 → 神酒／みき）。
 * @param fuhyo 付表の語と読み
 * @returns 照らし合わせ用の形
 */
function toFuhyoUnit(fuhyo: FuhyoWord): FuhyoUnit {
  const chars = Array.from(fuhyo.word);
  const reading = foldKana(fuhyo.reading);
  const { head, tail } = kanaEdges(chars, reading);
  const text = chars.slice(head, chars.length - tail);
  return {
    text: text.join(''),
    length: text.length,
    reading: reading.slice(head, reading.length - tail),
  };
}

/**
 * 常用漢字1字が取れる読みの一覧を作る（作ったものは覚えておく）。
 *
 * 音と訓に加え、訓の送り仮名を落とした形・連用形・送り仮名の許容の形を入れる。
 *
 * @param char 1字
 * @returns 読みの一覧。常用漢字でなければ undefined
 */
function candidatesOf(char: string): readonly Candidate[] | undefined {
  const cached = candidateCache.get(char);
  if (cached !== undefined) return cached;
  const info = getKanjiInfo(char);
  if (info === undefined) return undefined;
  const byKey = new Map<string, Candidate>();
  const add = (kana: string, cost: number, tail = ''): void => {
    const candidate = { kana: foldKana(kana), cost, tail };
    const key = `${candidate.kana}.${tail}`;
    const old = byKey.get(key);
    if (old === undefined || cost < old.cost) byKey.set(key, candidate);
  };
  for (const on of info.on) add(on, 0);
  for (const kun of info.kun) {
    const dot = kun.indexOf('.');
    const stem = dot < 0 ? kun : kun.slice(0, dot);
    const full = kun.replace('.', '');
    add(full, 0);
    if (dot < 0) continue;
    add(stem, COST_KUN_STEM);
    const renyou = RENYOU_ENDING.get(full.slice(-1));
    if (renyou !== undefined) add(full.slice(0, -1) + renyou, COST_KUN_RENYOU);
    // 送り仮名が2字以上で る で終わる訓（う.ける）は、る を落とすと連用形（うけ）になる
    if (full.length - dot >= 2 && full.endsWith('る')) add(full.slice(0, -1), COST_KUN_RENYOU);
    for (let k = 1; k < stem.length && k <= MAX_OKURI_KYOYO_KANA; k++) {
      add(stem.slice(0, -k), COST_OKURI_KYOYO, foldKana(stem.slice(-k)));
    }
  }
  for (const kana of EXTRA_READINGS.get(char) ?? []) add(kana, COST_KURU);
  const candidates = [...byKey.values()];
  candidateCache.set(char, candidates);
  return candidates;
}

/**
 * 字の位置 i・読みの位置 j から語の終わりまでの分け方を、点の低い順に返す（動的計画法）。
 * 同じ位置は1度だけ計算し、覚え書きに残す。
 * @param search 探す語
 * @param i 書き方の字の位置
 * @param j 読みの位置
 * @returns 分け方（点の低い順、MAX_SOLUTIONS 個まで）。合わなければ空
 */
function solve(search: Search, i: number, j: number): readonly Solution[] {
  const char = search.chars[i];
  if (char === undefined) return j === search.reading.length ? [EMPTY_SOLUTION] : [];
  if (j >= search.reading.length) return [];
  const key = i * (search.reading.length + 1) + j;
  const cached = search.memo.get(key);
  if (cached !== undefined) return cached;
  const solutions: Solution[] = [];
  for (const piece of piecesAt(search, char, i, j)) {
    for (const rest of solve(search, piece.end, piece.readingEnd)) {
      solutions.push({ cost: piece.cost + rest.cost, pieces: [piece, ...rest.pieces] });
    }
  }
  const kept = solutions.toSorted((a, b) => a.cost - b.cost).slice(0, MAX_SOLUTIONS);
  search.memo.set(key, kept);
  return kept;
}

/**
 * 字の位置 i・読みの位置 j から始まる、ありうる1つ分の対応をすべて挙げる。
 * 数字・英字・記号は読みと照らせないので何も返さない（語全体が当て字の扱いになる）。
 * @param search 探す語
 * @param char i 番目の字
 * @param i 書き方の字の位置
 * @param j 読みの位置
 * @returns 1つ分の対応の一覧
 */
function piecesAt(search: Search, char: string, i: number, j: number): Piece[] {
  const pieces = fuhyoPieces(search, i, j);
  if (KANA.test(char)) {
    pieces.push(...kanaPieces(search, char, i, j));
  } else if (REPEAT_MARK.test(char)) {
    // 々 は前の字の読みを繰り返す。前が表外字なら、表外字と同じくどの読みでもよい
    const previous = candidatesOf(search.chars[i - 1] ?? '');
    pieces.push(
      ...(previous === undefined
        ? hyogaiPieces(search, i, j, 1)
        : kanjiPieces(search, previous, i, j)),
    );
  } else if (KANJI.test(char)) {
    const candidates = candidatesOf(char);
    if (candidates !== undefined) {
      pieces.push(...kanjiPieces(search, candidates, i, j));
    } else {
      // 表外字が続くときは、続き全体を1つとして読みを当てる。
      // 前の対応はどれも表外字の続きの途中では終わらないので、ここに来るのは続きの頭だけ
      const length = search.chars.slice(i).findIndex((c) => !isHyogaiKanji(c));
      pieces.push(...hyogaiPieces(search, i, j, length < 0 ? search.chars.length - i : length));
    }
  }
  return pieces;
}

/**
 * 位置 i から始まる付表の語を、語全体の読み（音の変化を含む）で照らす。
 * @param search 探す語
 * @param i 書き方の字の位置
 * @param j 読みの位置
 * @returns 合った付表の語の対応
 */
function fuhyoPieces(search: Search, i: number, j: number): Piece[] {
  const pieces: Piece[] = [];
  for (const unit of fuhyoUnits) {
    const end = i + unit.length;
    if (search.chars.slice(i, end).join('') !== unit.text) continue;
    for (const variant of soundVariants(search, unit.reading, i, j, end)) {
      pieces.push(piece(i, end, j, variant.kana.length, 'fuhyo', COST_FUHYO + variant.cost));
    }
  }
  return pieces;
}

/**
 * 仮名1字を、読みの同じ仮名と照らす。「ヶ」は が・こ とも読める。
 * @param search 探す語
 * @param char 仮名1字
 * @param i 書き方の字の位置
 * @param j 読みの位置
 * @returns 合った対応
 */
function kanaPieces(search: Search, char: string, i: number, j: number): Piece[] {
  const pieces: Piece[] = [];
  const rest = search.reading.slice(j);
  if (rest.startsWith(foldKana(char))) pieces.push(piece(i, i + 1, j, 1, 'kana', 0));
  if (KE.test(char) && KE_VOICED.test(rest)) pieces.push(piece(i, i + 1, j, 1, 'kana', COST_KE));
  return pieces;
}

/**
 * 常用漢字1字を、その字の読み（音の変化を含む）で照らす。
 * @param search 探す語
 * @param candidates その字が取れる読み
 * @param i 書き方の字の位置
 * @param j 読みの位置
 * @returns 合った対応
 */
function kanjiPieces(
  search: Search,
  candidates: readonly Candidate[],
  i: number,
  j: number,
): Piece[] {
  const pieces: Piece[] = [];
  for (const candidate of candidates) {
    // 送り仮名の許容の形は、書き方の次の字が決まった仮名のときだけ使える
    const next = search.chars.slice(i + 1, i + 1 + candidate.tail.length).join('');
    if (foldKana(next) !== candidate.tail) continue;
    for (const variant of soundVariants(search, candidate.kana, i, j, i + 1)) {
      pieces.push(piece(i, i + 1, j, variant.kana.length, 'kanji', candidate.cost + variant.cost));
    }
  }
  return pieces;
}

/**
 * 表外字の続きに、どの読みでも当てる（1字あたり1〜MAX_KANA_PER_HYOGAI 字の仮名）。
 * @param search 探す語
 * @param i 書き方の字の位置
 * @param j 読みの位置
 * @param length 表外字が続く字の数
 * @returns ありうる対応
 */
function hyogaiPieces(search: Search, i: number, j: number, length: number): Piece[] {
  const rest = search.reading.slice(j);
  if (CANNOT_START.test(rest)) return [];
  const pieces: Piece[] = [];
  const max = Math.min(rest.length, MAX_KANA_PER_HYOGAI * length);
  for (let kanaLength = length; kanaLength <= max; kanaLength++) {
    pieces.push(piece(i, i + length, j, kanaLength, 'hyogai', COST_HYOGAI_PER_CHAR * length));
  }
  return pieces;
}

/**
 * 1つ分の対応を作る。
 * @param start 書き方の字の位置（はじめ）
 * @param end 書き方の字の位置（終わりの次）
 * @param readingStart 読みの位置（はじめ）
 * @param readingLength 読みの長さ
 * @param type 対応の種類
 * @param cost 点
 * @returns 対応
 */
function piece(
  start: number,
  end: number,
  readingStart: number,
  readingLength: number,
  type: Piece['type'],
  cost: number,
): Piece {
  return { start, end, readingStart, readingEnd: readingStart + readingLength, type, cost };
}

/**
 * 字の読み（または付表の語の読み）が、語の中で音の変化を起こした形を挙げる。
 *
 * 連濁は語の2字目から（語の頭では COST_RENDAKU_WORD_START の点で）、半濁音化・連声は ん・っ の後で、
 * 促音化は後ろに字が続くときだけ起こす。
 *
 * @param search 探す語
 * @param kana もとの読み
 * @param i 書き方の字の位置
 * @param j 読みの位置
 * @param end この読みが受け持つ字の終わりの次の位置
 * @returns もとの読みと、変化した形（点つき）
 */
function soundVariants(
  search: Search,
  kana: string,
  i: number,
  j: number,
  end: number,
): { kana: string; cost: number }[] {
  const variants = [{ kana, cost: 0 }];
  const first = kana.charAt(0);
  const previous = search.reading.charAt(j - 1);
  const voiced = RENDAKU.get(first);
  if (voiced !== undefined) {
    const cost = i > 0 ? COST_RENDAKU : COST_RENDAKU_WORD_START;
    variants.push({ kana: voiced + kana.slice(1), cost });
  }
  // 語の頭では previous が空なので、半濁音化と連声は起こらない
  const semiVoiced = HANDAKU.get(first);
  if (semiVoiced !== undefined && (previous === 'ん' || previous === 'っ')) {
    variants.push({ kana: semiVoiced + kana.slice(1), cost: COST_HANDAKU });
  }
  const linked = RENJO.get(first);
  if (linked !== undefined && previous === 'ん') {
    variants.push({ kana: linked + kana.slice(1), cost: COST_RENJO });
  }
  if (end < search.chars.length && kana.length >= 2 && SOKUON_ENDING.test(kana)) {
    for (const variant of [...variants]) {
      const geminated = `${variant.kana.slice(0, -1)}っ`;
      if (SOKUON_NEXT.test(search.reading.slice(j + geminated.length))) {
        variants.push({ kana: geminated, cost: variant.cost + COST_SOKUON });
      }
    }
  }
  return variants.filter((variant) => search.reading.startsWith(variant.kana, j));
}

/**
 * いちばん点の低い分け方から、字ごとの結果を作る。
 *
 * 同じ点の分け方がほかにもあり、表外字を含む部分の切れ目が分け方によって違うときは、
 * その部分を1つの固まりにする（常用の読みどうしの同点は、最初の分け方のままにする）。
 *
 * @param chars 書き方の字
 * @param shown 元の読み（ぢ・づ をそのまま残した形）
 * @param best いちばん点の低い分け方
 * @param solutions 分け方（点の低い順。best を含む）
 * @returns 字ごとの結果
 */
function toSegs(
  chars: readonly string[],
  shown: string,
  best: Solution,
  solutions: readonly Solution[],
): Seg[] {
  const ties = solutions.filter((solution) => solution.cost <= best.cost + COST_EPSILON);
  const undecided = undecidedChars(chars, best, ties);
  const units: Piece[] = [];
  for (const current of best.pieces) {
    const type = undecided.has(current.start) ? 'undecided' : current.type;
    const last = units.at(-1);
    // 決まらない部分と、続く仮名は1つにまとめる
    if (last?.type === type && (type === 'undecided' || type === 'kana')) {
      units[units.length - 1] = { ...last, end: current.end, readingEnd: current.readingEnd };
    } else {
      units.push({ ...current, type });
    }
  }
  return units.flatMap((unit) => segsOf(chars.slice(unit.start, unit.end), shown, unit));
}

/**
 * 同じ点の分け方どうしで切れ目が違い、表外字を含む部分の字の位置を挙げる。
 * @param chars 書き方の字
 * @param best いちばん点の低い分け方
 * @param ties best と同じ点の分け方（best を含む）
 * @returns 切れ目が決まらない字の位置
 */
function undecidedChars(
  chars: readonly string[],
  best: Solution,
  ties: readonly Solution[],
): Set<number> {
  const bestSpans = spansOf(best);
  const tieSpans = ties.map(spansOf);
  const undecided = new Set<number>();
  for (let k = 0; k < chars.length; k++) {
    if (tieSpans.some((spans) => spans[k] !== bestSpans[k])) undecided.add(k);
  }
  for (let start = 0; start < chars.length;) {
    let end = start;
    while (undecided.has(end)) end++;
    if (!chars.slice(start, end).some(isHyogaiKanji)) {
      for (let k = start; k < end; k++) undecided.delete(k);
    }
    start = end + 1;
  }
  return undecided;
}

/**
 * 分け方を、字の位置ごとの「受け持つ対応」を表す文字列にする（分け方どうしを比べるため）。
 * @param solution 分け方
 * @returns 字の位置ごとの文字列
 */
function spansOf(solution: Solution): string[] {
  return solution.pieces.flatMap((p) =>
    Array.from<string>({ length: p.end - p.start }).fill(
      `${String(p.start)}-${String(p.end)}:${String(p.readingStart)}-${String(p.readingEnd)}:${p.type}`,
    ),
  );
}

/**
 * 1つ分の対応を、結果の形にする。
 * @param base 対応する書き方の字
 * @param shown 元の読み
 * @param unit 対応
 * @returns 結果の1つ分（表外字が続くときは字ごとに分けることがある）
 */
function segsOf(base: readonly string[], shown: string, unit: Piece): Seg[] {
  const text = base.join('');
  const reading = shown.slice(unit.readingStart, unit.readingEnd);
  switch (unit.type) {
    case 'kana': {
      return [{ kind: 'kana', base: text }];
    }
    case 'kanji': {
      return [{ kind: 'kanji', base: text, reading, isHyogaiReading: false }];
    }
    case 'fuhyo': {
      return [{ kind: 'block', base: text, reading, why: 'jukujikun' }];
    }
    case 'undecided': {
      return [{ kind: 'block', base: text, reading, why: 'irregular' }];
    }
    case 'hyogai': {
      return hyogaiSegs(base, reading);
    }
  }
}

/**
 * 表外字の続きに当てた読みを、結果の形にする。
 *
 * 1字ならその字の読み（林檎 → 檎:ご）。2字以上で、字の数と読みの仮名の数が同じなら1字ずつ（薔薇 → 薔:ば＋薇:ら）。
 * それ以外は切れ目が決まらないので1つの固まり（檸檬 → れもん）。
 * 表外字の読みは常用漢字表にないので、isHyogaiReading を true にして、段階に関係なくルビを付けさせる。
 *
 * @param base 表外字の続き
 * @param reading 当てた読み
 * @returns 結果
 */
function hyogaiSegs(base: readonly string[], reading: string): Seg[] {
  if (base.length === 1 || reading.length === base.length) {
    const isWhole = base.length === 1;
    return base.map((char, k) => ({
      kind: 'kanji',
      base: char,
      reading: isWhole ? reading : reading.charAt(k),
      isHyogaiReading: true,
    }));
  }
  return [{ kind: 'block', base: base.join(''), reading, why: 'irregular' }];
}

/**
 * どの分け方でも合わない語（表外の読み・当て字）を、1つの固まりにする。両端の仮名は固まりの外に出す（生憎だ → 生憎＋だ）。
 * @param chars 書き方の字
 * @param reading 読み（仮名をそろえた形）
 * @param shown 元の読み
 * @returns 結果
 */
function irregularSegs(chars: readonly string[], reading: string, shown: string): Seg[] {
  const { head, tail } = kanaEdges(chars, reading);
  const segs: Seg[] = [];
  if (head > 0) segs.push({ kind: 'kana', base: chars.slice(0, head).join('') });
  segs.push({
    kind: 'block',
    base: chars.slice(head, chars.length - tail).join(''),
    reading: shown.slice(head, shown.length - tail),
    why: 'irregular',
  });
  if (tail > 0) segs.push({ kind: 'kana', base: chars.slice(chars.length - tail).join('') });
  return segs;
}
