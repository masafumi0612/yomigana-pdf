// 拡張に入る部品（dependencies とその先）のライセンスを確かめる。
// 開発の道具（devDependencies）は拡張に入らないので見ない。

import { execSync } from 'node:child_process';

/** 配ってよいライセンス（SPDX の名前）。MIT の拡張に同梱して問題のないものだけ */
const ALLOWED_LICENSES = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'OFL-1.1',
  'Unlicense',
  // pako（pdf-lib・fontkit が使う）が「MIT AND Zlib」。zlib License は MIT と同じくゆるいライセンス
  'Zlib',
]);

/** `npm query` が返す1つの部品のうち、使うところだけ */
interface PackageNode {
  name: string;
  version: string;
  location: string;
  license?: unknown;
  /** 古い部品の書き方（`licenses: [{ type: 'MIT' }]`） */
  licenses?: unknown;
}

/**
 * package.json のライセンスの書き方の違いをならして、1つの SPDX の式にする。
 *
 * @param node - `npm query` が返した部品
 * @returns SPDX の式。書かれていなければ undefined
 */
function licenseExpressionOf(node: PackageNode): string | undefined {
  const typeOf = (value: unknown): string | undefined =>
    typeof value === 'string'
      ? value
      : typeof value === 'object' && value !== null && 'type' in value
        ? String(value.type)
        : undefined;

  const single = typeOf(node.license);
  if (single !== undefined) {
    return single;
  }
  if (Array.isArray(node.licenses)) {
    // 古い書き方で複数あるときは、どれか1つを選んで使えるという意味
    const types = node.licenses.map(typeOf).filter((type) => type !== undefined);
    return types.length > 0 ? types.join(' OR ') : undefined;
  }
  return undefined;
}

/**
 * SPDX の式（`(MIT OR Apache-2.0) AND BSD-3-Clause` など）が、許すライセンスだけでできているかを調べる。
 * AND は OR より強く結びつく（SPDX の決まり）。WITH（例外の条項付き）は許さない。
 *
 * @param expression - SPDX の式
 * @returns OR はどれか1つ、AND はすべてが許されていれば true。読めない式は false
 */
function isAllowedExpression(expression: string): boolean {
  const tokens = expression.match(/\(|\)|[^\s()]+/gu) ?? [];
  let position = 0;

  const parseOr = (): boolean => {
    let isAllowed = parseAnd();
    while (tokens[position] === 'OR') {
      position += 1;
      // 右側も読み進めるため、先に呼んでから合わせる
      const isRightAllowed = parseAnd();
      isAllowed = isAllowed || isRightAllowed;
    }
    return isAllowed;
  };

  const parseAnd = (): boolean => {
    let isAllowed = parseAtom();
    while (tokens[position] === 'AND') {
      position += 1;
      const isRightAllowed = parseAtom();
      isAllowed = isAllowed && isRightAllowed;
    }
    return isAllowed;
  };

  const parseAtom = (): boolean => {
    const token = tokens[position];
    position += 1;
    if (token === '(') {
      const isAllowed = parseOr();
      const isClosed = tokens[position] === ')';
      position += 1;
      return isAllowed && isClosed;
    }
    return token !== undefined && ALLOWED_LICENSES.has(token);
  };

  const isAllowed = parseOr();
  // 読み残しがある（WITH など）ときは、読めない式として許さない
  return isAllowed && position === tokens.length;
}

function main(): void {
  const output = execSync('npm query .prod', { encoding: 'utf8' });
  const nodes = JSON.parse(output) as PackageNode[];
  // location が空のものはこのリポジトリ自身なので除く
  const packages = nodes.filter((node) => node.location !== '');
  const rejected = packages
    .map((node) => ({ node, expression: licenseExpressionOf(node) }))
    .filter(({ expression }) => expression === undefined || !isAllowedExpression(expression));

  for (const { node, expression } of rejected) {
    console.error(
      `許されていないライセンス: ${node.name}@${node.version}（${expression ?? 'ライセンスの記載なし'}）`,
    );
  }
  console.log(
    `拡張に入る部品 ${String(packages.length)} 件、許されないもの ${String(rejected.length)} 件`,
  );
  if (rejected.length > 0) {
    process.exitCode = 1;
  }
}

main();
