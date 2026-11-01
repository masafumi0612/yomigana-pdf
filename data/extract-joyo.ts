// 常用漢字表（文化庁、平成22年内閣告示第2号）の PDF から、字ごとの音訓と付表の語を取り出す。
// 座標の数は joyokanjihyo_20101130.pdf の組み方に合わせたもの（ほかの版の PDF には合わない）
import { openPdf, type PdfTextItem, readPageItems } from './pdf-text.ts';

/** 本表のページ */
const MAIN_FIRST_PAGE = 11;
const MAIN_LAST_PAGE = 161;
/** 付表のページ */
const FUHYO_PAGES = [162, 163];
/** 本表の最初のページの見出し（「本表」）より上の y */
const MAIN_HEADER_MIN_Y = 800;
/** 見出しの漢字と旧字体は大きい字で組まれている */
const BIG_TEXT_MIN_SIZE = 15;
/** 左端の索引（「ライ-リ」など）より左の x */
const INDEX_TAB_MAX_X = 100;
/** 見出しの漢字より左の x */
const HEADWORD_MAX_X = 120;
/** 旧字体（と最初の読み）の欄の x */
const OLD_FORM_MIN_X = 110;
const OLD_FORM_MAX_X = 165;
/** 音訓の欄の x */
const READING_MIN_X = 160;
const READING_MAX_X = 240;
/** 例の欄の x（その右は備考の欄） */
const EXAMPLE_MAX_X = 390;
/** 付表の語と読みは小さい字で組まれている */
const FUHYO_MAX_SIZE = 12;
/** 付表の最初のページの説明文より下の y */
const FUHYO_FIRST_PAGE_MAX_Y = 720;
/** 付表は左右2段。右の段が始まる x */
const FUHYO_RIGHT_HALF_X = 300;
/** 段の左端から、読みの欄の幅と、語の欄が始まるまで */
const FUHYO_READING_WIDTH = 20;
const FUHYO_WORD_OFFSET = 60;
/** 語と読みを同じ行とみなす y の差 */
const FUHYO_ROW_TOLERANCE = 12;

const SINGLE_KANJI = /^[㐀-鿿\u{20000}-\u{2FFFF}]$/u;
const HAS_KANJI = /[㐀-鿿]/u;
const KATAKANA = /^[ァ-ヶー]+$/u;
const HIRAGANA = /^[ぁ-ゖー]+$/u;
const OLD_FORM_ITEM = /^\s*[（(]?([^）)\s]*)[）)]?\s*([ァ-ヶぁ-ゖー]*)\s*$/u;
const ALLOWED_FORM_ITEM = /^\s*\[.*\]\s*$/u;

/** 常用漢字表の1字 */
export interface JoyoKanji {
  char: string;
  /** 旧字体（康熙字典体）。ないときは undefined */
  old: string | undefined;
  /** 音（片仮名） */
  on: string[];
  /** 訓（平仮名。送り仮名は「かこ.む」のように . で分ける） */
  kun: string[];
}

/** 付表の1行（同じ読みの語をまとめたもの） */
export interface JoyoFuhyoRow {
  reading: string;
  words: string[];
}

/** 常用漢字表から取り出したもの */
export interface JoyoTable {
  kanji: JoyoKanji[];
  fuhyo: JoyoFuhyoRow[];
  /** 置き場所が決まらなかったかたまりなどの知らせ */
  warnings: string[];
}

interface RawReading {
  raw: string;
  examples: string;
}

interface RawEntry {
  char: string;
  old: string;
  readings: RawReading[];
}

/**
 * 常用漢字表の PDF を読む。
 * @param file joyokanjihyo_20101130.pdf の場所
 * @returns 字ごとの音訓と付表
 */
export async function extractJoyo(file: string): Promise<JoyoTable> {
  const doc = await openPdf(file);
  const warnings: string[] = [];
  const entries: RawEntry[] = [];
  for (let page = MAIN_FIRST_PAGE; page <= MAIN_LAST_PAGE; page++) {
    const items = await readPageItems(doc, page);
    // 上の行から、同じ行の中は左から読む
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of items) {
      readMainItem(item, page, entries, warnings);
    }
  }
  const fuhyo: JoyoFuhyoRow[] = [];
  for (const page of FUHYO_PAGES) {
    const items = (await readPageItems(doc, page)).filter(
      (it) =>
        it.size < FUHYO_MAX_SIZE && (page !== FUHYO_PAGES[0] || it.y < FUHYO_FIRST_PAGE_MAX_Y),
    );
    fuhyo.push(
      ...readFuhyoHalf(
        items.filter((it) => it.x < FUHYO_RIGHT_HALF_X),
        warnings,
      ),
    );
    fuhyo.push(
      ...readFuhyoHalf(
        items.filter((it) => it.x >= FUHYO_RIGHT_HALF_X),
        warnings,
      ),
    );
  }
  return { kanji: entries.map((e) => toKanji(e, warnings)), fuhyo, warnings };
}

function readMainItem(
  item: PdfTextItem,
  page: number,
  entries: RawEntry[],
  warnings: string[],
): void {
  const current = entries.at(-1);
  const isBig = item.size > BIG_TEXT_MIN_SIZE;
  if (page === MAIN_FIRST_PAGE && item.y > MAIN_HEADER_MIN_Y) return;
  if (item.x < INDEX_TAB_MAX_X && !isBig) return;
  // 「[餌]」は許容字体。文字の番号は見出しと同じなので読まない
  // （番号が別の 𠮟 と叱などの4組は、文字の層にないので build-kanji.ts で足す）
  if (isBig && ALLOWED_FORM_ITEM.test(item.str)) return;
  if (isBig && item.x < HEADWORD_MAX_X && !/^\s*[（(]/u.test(item.str)) {
    const char = item.str.trim();
    if (SINGLE_KANJI.test(char)) entries.push({ char, old: '', readings: [] });
    else if (!/^本|表$/u.test(char)) warnings.push(`見出しでない大きい字 p${String(page)} ${char}`);
    return;
  }
  if (current === undefined) return;
  if (isBig && item.x >= OLD_FORM_MIN_X && item.x < OLD_FORM_MAX_X) {
    // 「（圍） イ」のように、旧字体と最初の読みが1つか複数のかたまりに入っている
    const match = OLD_FORM_ITEM.exec(item.str);
    if (match === null) {
      warnings.push(`旧字体の欄を読めない p${String(page)} ${current.char} ${item.str}`);
      return;
    }
    current.old += match[1] ?? '';
    const reading = match[2] ?? '';
    if (reading !== '') current.readings.push({ raw: reading, examples: '' });
    return;
  }
  if (item.x >= READING_MIN_X && item.x < READING_MAX_X) {
    current.readings.push({ raw: item.str.trim(), examples: '' });
    return;
  }
  if (item.x >= READING_MAX_X && item.x < EXAMPLE_MAX_X) {
    // 例が長いと次の行に折り返すので、直前の読みに足していく
    const last = current.readings.at(-1);
    if (last !== undefined) last.examples += item.str;
    return;
  }
  // 備考の欄は使わない
  if (item.x < EXAMPLE_MAX_X) {
    warnings.push(`置き場所のないかたまり p${String(page)} ${current.char} ${item.str}`);
  }
}

function toKanji(entry: RawEntry, warnings: string[]): JoyoKanji {
  const on: string[] = [];
  const kun: string[] = [];
  for (const reading of entry.readings) {
    if (KATAKANA.test(reading.raw)) {
      on.push(reading.raw);
    } else if (HIRAGANA.test(reading.raw)) {
      const examples = reading.examples
        .split(/[,，、]/u)
        .map((s) => s.replaceAll(/〔[^〕]*〕/gu, '').trim())
        .filter((s) => s !== '');
      kun.push(splitOkurigana(entry.char, reading.raw, examples));
    } else {
      warnings.push(`音でも訓でもない読み ${entry.char} ${reading.raw}`);
    }
  }
  return { char: entry.char, old: entry.old === '' ? undefined : entry.old, on, kun };
}

// 表では送り仮名を細い字で示しているが、文字の層からはその区別が消える。
// 例から取り戻す：訓「かこむ」の例「囲む」で、漢字のすぐ後の仮名「む」が読みの終わりと合うので
// 「かこ.む」とする
function splitOkurigana(char: string, kun: string, examples: string[]): string {
  let best = 0;
  for (const example of examples) {
    let i = example.indexOf(char);
    while (i >= 0) {
      const tail = /^[ぁ-ゖ]*/u.exec(example.slice(i + char.length))?.[0] ?? '';
      for (let n = Math.min(tail.length, kun.length - 1); n > best; n--) {
        if (kun.endsWith(tail.slice(0, n))) {
          best = n;
          break;
        }
      }
      i = example.indexOf(char, i + 1);
    }
  }
  return best === 0 ? kun : `${kun.slice(0, kun.length - best)}.${kun.slice(kun.length - best)}`;
}

function readFuhyoHalf(items: PdfTextItem[], warnings: string[]): JoyoFuhyoRow[] {
  const left = Math.min(...items.map((it) => it.x));
  const rows = items
    .filter((it) => it.x < left + FUHYO_READING_WIDTH && HIRAGANA.test(it.str.trim()))
    .map((it) => ({ reading: it.str.trim(), y: it.y, words: [] as string[] }));
  for (const it of items) {
    if (it.x <= left + FUHYO_WORD_OFFSET || !HAS_KANJI.test(it.str)) continue;
    let nearest: (typeof rows)[number] | undefined;
    for (const row of rows) {
      if (nearest === undefined || Math.abs(row.y - it.y) < Math.abs(nearest.y - it.y)) {
        nearest = row;
      }
    }
    if (nearest !== undefined && Math.abs(nearest.y - it.y) < FUHYO_ROW_TOLERANCE) {
      nearest.words.push(it.str.trim());
    } else {
      warnings.push(`付表の語の行が決まらない ${it.str}`);
    }
  }
  return rows.sort((a, b) => b.y - a.y).map(({ reading, words }) => ({ reading, words }));
}
