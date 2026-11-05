import { createHash } from 'node:crypto';

/** PDF の標準のセキュリティ（RC4 40 ビット）で使う、32 バイトの詰め物 */
const PADDING = Buffer.from(
  '28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a',
  'hex',
);
/** 権限の値（-4：すべて許す）を、下の桁から並べた4バイト */
const PERMISSIONS = Buffer.from('fcffffff', 'hex');
/** 40 ビットの鍵の長さ（バイト） */
const KEY_LENGTH = 5;
/** 本文の流れを持つオブジェクトの番号 */
const CONTENT_OBJECT = 4;
/** RC4 の内部の表の大きさ */
const RC4_STATE_SIZE = 256;

const md5 = (...parts: Buffer[]): Buffer => createHash('md5').update(Buffer.concat(parts)).digest();

/**
 * RC4 で符号化する（Node の OpenSSL では RC4 が使えないことがあるので自分で書く）。
 * @param key 鍵
 * @param data 符号化するもの
 * @returns 符号化したもの
 */
function rc4(key: Buffer, data: Buffer): Buffer {
  const state = Array.from({ length: RC4_STATE_SIZE }, (_, i) => i);
  const at = (index: number): number => state[index] ?? 0;
  let j = 0;
  for (let i = 0; i < RC4_STATE_SIZE; i++) {
    j = (j + at(i) + (key[i % key.length] ?? 0)) % RC4_STATE_SIZE;
    [state[i], state[j]] = [at(j), at(i)];
  }
  const out = Buffer.alloc(data.length);
  let a = 0;
  let b = 0;
  for (let n = 0; n < data.length; n++) {
    a = (a + 1) % RC4_STATE_SIZE;
    b = (b + at(a)) % RC4_STATE_SIZE;
    [state[a], state[b]] = [at(b), at(a)];
    out[n] = (data[n] ?? 0) ^ at((at(a) + at(b)) % RC4_STATE_SIZE);
  }
  return out;
}

const pad = (password: string): Buffer =>
  Buffer.concat([Buffer.from(password, 'latin1'), PADDING]).subarray(0, 32);

/**
 * パスワード付きの1ページの PDF を組み立てる（テストの中だけで使う、自分で書いた文）。
 * @param password 開くためのパスワード
 * @returns PDF のバイト列
 */
export function buildEncryptedPdf(password: string): Buffer {
  const id = md5(Buffer.from('yomigana-pdf-e2e'));
  const owner = rc4(md5(pad(`owner-${password}`)).subarray(0, KEY_LENGTH), pad(password));
  const key = md5(pad(password), owner, PERMISSIONS, id).subarray(0, KEY_LENGTH);
  const user = rc4(key, PADDING);
  const objectKey = md5(key, Buffer.from([CONTENT_OBJECT, 0, 0, 0, 0])).subarray(0, KEY_LENGTH + 5);
  const content = rc4(objectKey, Buffer.from('BT /F1 24 Tf 72 700 Td (Hello PDF) Tj ET', 'latin1'));

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n', 'latin1')];
  const sizeSoFar = (): number => parts.reduce((sum, part) => sum + part.length, 0);
  const offsets: number[] = [];
  const add = (number: number, body: Buffer | string): void => {
    offsets[number] = sizeSoFar();
    parts.push(
      Buffer.from(`${String(number)} 0 obj\n`),
      Buffer.from(body),
      Buffer.from('\nendobj\n'),
    );
  };
  add(1, '<< /Type /Catalog /Pages 2 0 R >>');
  add(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  add(
    3,
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
  );
  add(
    CONTENT_OBJECT,
    Buffer.concat([
      Buffer.from(`<< /Length ${String(content.length)} >>\nstream\n`),
      content,
      Buffer.from('\nendstream'),
    ]),
  );
  add(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  add(
    6,
    `<< /Filter /Standard /V 1 /R 2 /O <${owner.toString('hex')}> /U <${user.toString('hex')}> /P -4 >>`,
  );
  const xrefAt = sizeSoFar();
  const rows = offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`);
  const idHex = id.toString('hex');
  parts.push(
    Buffer.from(
      `xref\n0 7\n0000000000 65535 f \n${rows.join('')}trailer\n` +
        `<< /Size 7 /Root 1 0 R /Encrypt 6 0 R /ID [<${idHex}> <${idHex}>] >>\n` +
        `startxref\n${String(xrefAt)}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(parts);
}
