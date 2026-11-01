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
]);

/** `npm query` が返す1つの部品のうち、使うところだけ */
interface PackageNode {
  name: string;
  version: string;
  location: string;
  license?: unknown;
}

/**
 * SPDX の式（`MIT OR Apache-2.0` など）が、許すライセンスだけでできているかを調べる。
 *
 * @param expression - package.json の `license` の値
 * @returns OR はどれか1つ、AND はすべてが許されていれば true
 */
function isAllowedExpression(expression: string): boolean {
  const body = expression.trim().replace(/^\((.*)\)$/u, '$1');
  if (body.includes(' OR ')) {
    return body.split(' OR ').some((part) => isAllowedExpression(part));
  }
  if (body.includes(' AND ')) {
    return body.split(' AND ').every((part) => isAllowedExpression(part));
  }
  return ALLOWED_LICENSES.has(body);
}

function main(): void {
  const output = execSync('npm query .prod', { encoding: 'utf8' });
  const nodes = JSON.parse(output) as PackageNode[];
  // location が空のものはこのリポジトリ自身なので除く
  const packages = nodes.filter((node) => node.location !== '');
  const rejected = packages.filter(
    (node) => typeof node.license !== 'string' || !isAllowedExpression(node.license),
  );

  for (const node of rejected) {
    console.error(
      `許されていないライセンス: ${node.name}@${node.version}（${String(node.license)}）`,
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
