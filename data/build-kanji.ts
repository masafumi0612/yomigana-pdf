// 漢字の段階のデータ src/text/data/kanji.json と、付表の語 src/text/data/fuhyo.json を作る。
//   npm run data:build
// 元のデータはリポジトリの外に置く（data/SOURCES.md）。場所は環境変数 FURIGANA_DATA_DIR、
// なければ ~/dev/furigana-data。数が決まりと合わなければ、何も書かずに止まる
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { format, resolveConfig } from 'prettier';

import { extractGrades } from './extract-grades.ts';
import { extractJoyo, type JoyoKanji } from './extract-joyo.ts';

/** 常用漢字の数 */
const JOYO_COUNT = 2136;
/** 学年別漢字配当表の、1年〜6年の字の数 */
const GRADE_COUNTS = [80, 160, 200, 202, 193, 191];
/** 小学校で習わない字を、よく使われる順に分ける段階と字の数（中1・中2の目安と、残り） */
const UPPER_TIERS = [
  { tier: 'm1', size: 350 },
  { tier: 'm2', size: 400 },
  { tier: 'joyo', size: 360 },
];
/** 付表の行（読み）と語の数 */
const FUHYO_ROW_COUNT = 116;
const FUHYO_WORD_COUNT = 123;
/** 常用漢字表が認める許容字体のうち、文字の番号が別のもの（正字体, 許容字体） */
const ALLOWED_FORMS: readonly (readonly [string, string])[] = [
  ['𠮟', '叱'],
  ['塡', '填'],
  ['剝', '剥'],
  ['頰', '頬'],
];
/** kanji.json の形の版。形を変えたら上げる */
const DATA_VERSION = 1;
const SOURCES = [
  '常用漢字表（文化庁、平成22年内閣告示第2号）',
  '音訓の小・中・高等学校段階別割り振り表（文部科学省、平成29年3月）',
  'scriptin/kanji-frequency 62df9362（CC BY 4.0、青空文庫と Wikipedia の字の数。順位に直して使用）',
];

const dataDir = process.env.FURIGANA_DATA_DIR ?? join(homedir(), 'dev', 'furigana-data');
const outDir = fileURLToPath(new URL('../src/text/data/', import.meta.url));

/** kanji.json の1字 */
interface KanjiEntry {
  tier: string;
  on: string[];
  kun: string[];
}

function check(isOk: boolean, message: string): void {
  if (!isOk) throw new Error(`データが決まりと合わない：${message}`);
}

/** 頻度の CSV（rank,code_point_hex,char,char_count）を、字ごとの数にする */
function readCounts(file: string): Map<string, number> {
  const counts = new Map<string, number>();
  const lines = readFileSync(file, 'utf8').split(/\r?\n/u);
  for (const line of lines.slice(1)) {
    const [rank, , char, count] = line.split(',');
    // 0番目の行は全体の数
    if (rank === undefined || rank === '0' || char === undefined || count === undefined) continue;
    const key = char.normalize('NFKC');
    counts.set(key, (counts.get(key) ?? 0) + Number(count));
  }
  return counts;
}

/** 字の並びの同点を決めるため、正字体の文字の番号で比べる */
function byCodePoint(a: string, b: string): number {
  return (a.codePointAt(0) ?? 0) - (b.codePointAt(0) ?? 0);
}

/** 字を数の多い順に並べ、1からの順位を返す */
function rankByCount(chars: string[], countOf: (char: string) => number): Map<string, number> {
  const sorted = [...chars].sort((a, b) => countOf(b) - countOf(a) || byCodePoint(a, b));
  return new Map(sorted.map((char, i) => [char, i + 1]));
}

async function writeJson(name: string, value: unknown): Promise<void> {
  const path = join(outDir, name);
  const options = await resolveConfig(path);
  // 1字が1行に収まる形にして、差分を読みやすくする（Prettier の整形と同じ結果にする）
  writeFileSync(path, await format(JSON.stringify(value), { ...options, filepath: path }));
}

const joyo = await extractJoyo(join(dataDir, 'joyo', 'joyokanjihyo_20101130.pdf'));
check(joyo.warnings.length === 0, `常用漢字表の読み残し\n${joyo.warnings.join('\n')}`);
const joyoChars = joyo.kanji.map((k) => k.char);
const joyoSet = new Set(joyoChars);
check(joyoChars.length === JOYO_COUNT, `常用漢字が ${String(joyoChars.length)} 字`);
check(joyoSet.size === JOYO_COUNT, '常用漢字に重なりがある');
check(
  ALLOWED_FORMS.every(([standard, allowed]) => joyoSet.has(standard) && !joyoSet.has(allowed)),
  '許容字体の組が常用漢字表と合わない',
);

const { kanji: wakefuriChars, grades } = await extractGrades(
  join(dataDir, 'mext', 'onkun-wakefuri-h29.pdf'),
);
check(new Set(wakefuriChars).size === wakefuriChars.length, '割り振り表の漢字に重なりがある');
check(
  wakefuriChars.every((char) => joyoSet.has(char)),
  '割り振り表に常用漢字でない字がある',
);
GRADE_COUNTS.forEach((expected, i) => {
  const actual = [...grades.values()].filter((grade) => grade === i + 1).length;
  check(actual === expected, `${String(i + 1)}年の字が ${String(actual)} 字`);
});

const formsOf = (char: string): string[] => [
  char,
  ...ALLOWED_FORMS.filter(([standard]) => standard === char).map(([, allowed]) => allowed),
];
const aozora = readCounts(join(dataDir, 'scriptin', 'aozora_characters.csv'));
const wikipedia = readCounts(join(dataDir, 'scriptin', 'wikipedia_characters.csv'));
// 許容字体で書かれた数も同じ字の数に足す（実際の文章はほとんど許容字体で書かれている）
const sumForms =
  (counts: Map<string, number>) =>
  (char: string): number =>
    formsOf(char).reduce((sum, form) => sum + (counts.get(form) ?? 0), 0);

const upperChars = joyoChars.filter((char) => !grades.has(char));
const upperTotal = UPPER_TIERS.reduce((sum, t) => sum + t.size, 0);
check(upperChars.length === upperTotal, `小学校で習わない字が ${String(upperChars.length)} 字`);
const missing = upperChars.filter(
  (char) => sumForms(aozora)(char) === 0 || sumForms(wikipedia)(char) === 0,
);
check(missing.length === 0, `頻度のデータにない字 ${missing.join('')}`);
const aozoraRank = rankByCount(upperChars, sumForms(aozora));
const wikipediaRank = rankByCount(upperChars, sumForms(wikipedia));
const meanRank = (char: string): number =>
  ((aozoraRank.get(char) ?? 0) + (wikipediaRank.get(char) ?? 0)) / 2;
const byFrequency = [...upperChars].sort((a, b) => meanRank(a) - meanRank(b) || byCodePoint(a, b));

const tiers = new Map<string, string>();
for (const [char, grade] of grades) tiers.set(char, `g${String(grade)}`);
let start = 0;
for (const { tier, size } of UPPER_TIERS) {
  for (const char of byFrequency.slice(start, start + size)) tiers.set(char, tier);
  start += size;
}

const kanji: Record<string, KanjiEntry> = {};
const entryOf = (k: JoyoKanji): KanjiEntry => ({
  tier: tiers.get(k.char) ?? '',
  on: k.on,
  kun: k.kun,
});
// 常用漢字表の順に並べ、許容字体は正字体のすぐ後に置く
for (const k of joyo.kanji) {
  for (const form of formsOf(k.char)) kanji[form] = entryOf(k);
}
check(
  Object.values(kanji).every((entry) => entry.tier !== ''),
  '段階の決まらない字がある',
);

const fuhyo = joyo.fuhyo.flatMap(({ reading, words }) => words.map((word) => ({ word, reading })));
check(joyo.fuhyo.length === FUHYO_ROW_COUNT, `付表の行が ${String(joyo.fuhyo.length)} 行`);
check(fuhyo.length === FUHYO_WORD_COUNT, `付表の語が ${String(fuhyo.length)} 語`);

await writeJson('kanji.json', { version: DATA_VERSION, sources: SOURCES, kanji });
await writeJson('fuhyo.json', { version: DATA_VERSION, sources: SOURCES.slice(0, 1), fuhyo });

const tierNames = [
  ...GRADE_COUNTS.map((_, i) => `g${String(i + 1)}`),
  ...UPPER_TIERS.map((t) => t.tier),
];
const countOfTier = (tier: string): number => [...tiers.values()].filter((t) => t === tier).length;
console.log(
  `常用漢字 ${String(joyoChars.length)} 字（許容字体を足して ${String(Object.keys(kanji).length)} 字）`,
);
console.log(`段階：${tierNames.map((tier) => `${tier} ${String(countOfTier(tier))}`).join('、')}`);
console.log(`付表 ${String(fuhyo.length)} 語`);
