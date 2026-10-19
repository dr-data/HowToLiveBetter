// README 的結構解析和文件清單：EPUB（tools/epub）和 PDF（tools/pdf）兩套構建共用。
// 只認 README 裡的結構，不維護文件名單——新增一節或一篇長文，兩套構建都自動跟上。
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const REPO = 'https://github.com/eternity4719/HowToLiveBetter';
export const SITE = 'https://eternity4719.github.io/HowToLiveBetter/';
export const TITLE = '高性價比人生指南';
export const RELEASE = `${REPO}/releases/download/epub-latest`;

// 一律按 LF 交給各套構建：Windows 上 core.autocrlf=true 檢出的是 CRLF，離線版腳本
// 拿 '\n' 寫的 needle 去 index.html 裡找錨點就一個都找不著，本地構建直接報「找不到
// 主腳本的開頭」（CI 是 Linux，從沒碰到過）。正文解析也不必各自處理 \r。
export const read = p => readFileSync(resolve(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
export const unique = arr => [...new Set(arr)];

export function gitCommit() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return process.env.GITHUB_SHA ?? '';
  }
}

// 正文一天可能改好幾輪，只給日期分不出是哪一版，所以精確到分鐘。
// CI 跑在 UTC 上，統一按北京時間顯示，免得下載的人按自己那邊的日期對不上。
export function buildStamp() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' }).format(new Date());
}

export function stripBackLink(md) {
  return md.replace(/^\[← 回總目錄\]\([^)]*\)\s*\n/, '');
}

// README 裡從某個標題到下一個標題之間的一段
export function readBook() {
  const readme = read('README.md');
  const lines = readme.split('\n');
  const between = (from, to) => {
    const a = lines.findIndex(l => l.startsWith(from));
    const b = lines.findIndex((l, i) => i > a && l.startsWith(to));
    if (a < 0 || b < 0) throw new Error(`README 裡找不到 ${from} 到 ${to} 這一段`);
    return lines.slice(a, b).join('\n');
  };
  const description = between('# 高性價比人生指南', '[![')
    .split('\n').slice(1).map(l => l.replace(/<[^>]+>/g, '').trim()).filter(Boolean).join('');
  const frontMd = between('## 這本書想回答的問題', '## 目錄');
  const contentsMd = between('## 目錄', '## 正文')
    .split('\n\n').filter(p => !p.includes('index.html')).join('\n\n');
  const bookFiles = unique([...contentsMd.matchAll(/\]\((book\/[^)#]+\.md)\)/g)].map(m => m[1]));
  const docFiles = unique([...readme.matchAll(/\]\((docs\/[^)#/]+\.md)\)/g)].map(m => m[1]));
  if (bookFiles.length === 0) throw new Error('README 目錄裡沒找到 book/ 文件');
  return { readme, description, frontMd, contentsMd, bookFiles, docFiles };
}

// 性價比三檔：和 index.html 的 COST_W、e.ratio 兩行一致，sync-stats.mjs 每次運行都會比對一次。
// 統計數字和 Anki 牌組的標籤共用這一份。
export const COST_W = {
  money: { '0': 0, '少': 1, '多': 2 },
  time: { '少': 0, '中': 1, '多': 2 },
  will: { '否': 0, '些': 1, '是': 2 },
};

export function ratioOf(cost, level) {
  if (level === '大') return cost === 0 ? '極高' : cost <= 2 ? '高' : '一般';
  return level === '中' && cost === 0 ? '高' : '一般';
}
