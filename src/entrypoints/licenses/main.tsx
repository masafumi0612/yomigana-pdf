// 設定の画面と同じ色・文字・焦点の線を使うため、設定の画面の見た目を先に読む
import '../options/style.css';
import './style.css';

import { render } from 'preact';

import { LicensesPage } from '@/options/licenses-page';
import { message } from '@/options/message';

const root = document.getElementById('app');
if (root === null) {
  throw new TypeError('ライセンスと出典の画面に #app がない');
}
document.title = message('licenses_page_title');
render(<LicensesPage />, root);
