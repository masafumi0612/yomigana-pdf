// 読みの処理で使う表（src/text/data/*.tsv）を読む

/**
 * タブ区切りの表（TSV）を読む。1行目は列の名前で、空の行は飛ばす。
 * 表はビルドに入れるデータなので、形が違うときは作り間違いとして例外を投げる。
 * @param raw 表の文字列
 * @param columns 1行目にあるはずの列の名前（左から順に）
 * @returns 2行目からの行。列の名前でセルを引ける。行の終わりの空のセルは省いてよく、空の文字列になる
 */
export function parseTsv<Column extends string>(
  raw: string,
  columns: readonly Column[],
): Record<Column, string>[] {
  const [header, ...lines] = raw.split(/\r?\n/u).filter((line) => line !== '');
  if (header !== columns.join('\t')) {
    throw new Error(`表の列の名前が違う：${header ?? '（空）'}`);
  }
  return lines.map((line) => {
    const cells = line.split('\t');
    if (cells.length > columns.length) {
      throw new Error(`表の列が多すぎる：${line}`);
    }
    // 列の名前をキーにした形として組み立てる
    return Object.fromEntries(
      columns.map((column, index) => [column, cells[index] ?? '']),
    ) as Record<Column, string>;
  });
}
