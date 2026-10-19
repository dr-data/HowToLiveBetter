// 統計對齊：改完條目跑一次。按順序做四件事：
// ① 重算全書的統計數字，回寫 README.md、index.html、tools/og.html；
// ② 調 check-refs.mjs 重算 docs/引用对照.md，调 updates.mjs 重算 updates.json；
// ③ 調 check-plain.mjs 查說人話，不合格只提示不中斷；
// ④ 用無頭 Chrome 把 tools/og.html 重新截成 og.png。
//
//   node tools/sync-stats.mjs                   # 全做
//   node tools/sync-stats.mjs --no-screenshot   # 不截圖
//   node tools/sync-stats.mjs --check           # 只比對 ① 不寫，有過時的數字則退出碼 1（CI 用）
//
// Chrome 按常見安裝位置找，裝在別處就設環境變量 CHROME 指到可執行文件。
// og.html 用的是微軟雅黑，Linux 上沒有就會換成別的字體，截出來的圖和 Windows 上不一樣；
// CI 只跑 --check 不截圖，也是這個原因。
//
// 2026-09-29 從 sync-stats.ps1 移植過來，ps1 已刪：它只在 Windows 上跑，
// 網頁上直接合並的外部 PR 完全經過不了它，數字過時了也沒有任何檢查會紅。
// ① 只替換數字本身，不動任何其他文字。
// 數字口徑：條目數 = book/*.md 裡的 ### 標題數；節數 = book/*.md 的文件數；
// A/B/C = 證據等級行的首字母（帶（爭議）後綴的照樣算）；爭議 = 備註以「爭議」開頭的條數；
// TODO = 正文裡含「待核實」或「TODO」的行數；鏈接 = 「- 來源：」和「- 備註：」行裡的 http(s) 總數；
// 性價比三檔的規則在 tools/lib/book.mjs，抄自 index.html。
// 切行用 /\r?\n/，理由見 check-refs.mjs 文件頭。
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { COST_W as W, ratioOf } from './lib/book.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');
const read = f => readFileSync(join(ROOT, f), 'utf8');

// 檔位規則（tools/lib/book.mjs）和 index.html 的 COST_W、e.ratio 兩行一致；那兩行改了那邊必須跟著改，所以先比對一次
const indexText = read('index.html');
const COST_W_LINE = "const COST_W = { money:{'0':0,'少':1,'多':2}, time:{'少':0,'中':1,'多':2}, will:{'否':0,'些':1,'是':2} };";
const RATIO_LINE = "e.ratio = e.level === '大' ? (e.cs === 0 ? '極高' : (e.cs <= 2 ? '高' : '一般'))";
if (!indexText.includes(COST_W_LINE)) throw new Error('index.html 的 COST_W 行變了，請同步 tools/lib/book.mjs 裡的成本權重');
if (!indexText.includes(RATIO_LINE)) throw new Error('index.html 的 e.ratio 行變了，請同步 tools/lib/book.mjs 裡的檔位規則');

const bookFiles = readdirSync(join(ROOT, 'book')).filter(f => f.endsWith('.md')).sort();
const sections = bookFiles.length;
let entries = 0, dispute = 0, todo = 0, links = 0;
const grade = { A: 0, B: 0, C: 0 };
const ratio = { '極高': 0, '高': 0, '一般': 0 };
// 成本標籤裡「人群=」的取值表，和 index.html 的 WHO_LABEL、側欄「我的情況」按鈕一一對應
const WHO = new Set(['懷孕', '嬰幼兒', '孩子', '老人', '35歲', '60歲', '女性']);
const badWho = [];

for (const f of bookFiles) {
  for (const line of read(join('book', f)).split(/\r?\n/)) {
    if (line.startsWith('### ')) entries++;
    const g = line.match(/^- 證據等級：([ABC])/);
    if (g) grade[g[1]]++;
    if (line.startsWith('- 備註：爭議')) dispute++;
    if (/待核實|TODO/.test(line)) todo++;
    if (/^- (來源|備註)：/.test(line)) links += (line.match(/https?:\/\//g) ?? []).length;
    const t = line.match(/<!--\s*成本標籤:\s*錢=(\S+)\s+時間=(\S+)\s+毅力=(\S+)\s+收益=(\S+)\s+口徑=/);
    if (t) ratio[ratioOf(W.money[t[1]] + W.time[t[2]] + W.will[t[3]], t[4])]++;
    const w = line.match(/<!--\s*成本標籤:.*\s人群=(\S+)/);
    if (w) for (const v of w[1].split(/[,+]/)) if (!WHO.has(v)) badWho.push(`${f}：${v}`);
  }
}
if (badWho.length) { console.error(`人群標籤有不認識的值（只許 ${[...WHO].join('、')}）：\n  ${badWho.join('\n  ')}`); process.exitCode = 1; }

const tagged = ratio['極高'] + ratio['高'] + ratio['一般'];
if (tagged !== entries) console.warn(`警告：有 ${entries - tagged} 條缺成本標籤，性價比三檔對不上條目數`);
if (grade.A + grade.B + grade.C !== entries) console.warn('警告：證據等級行數和條目數對不上，檢查有沒有條目漏寫證據等級');

// 三檔百分比用最大余數法分配：先向下取整，剩下的百分點按小數部分從大到小補。
// 三個數各自四捨五入會湊出 99 或者 101（2026-09-21 加第 33 節時碰到過），這裡保證加起來正好 100。
const ORDER = ['極高', '高', '一般'];
const pct = {}, rem = {};
for (const k of ORDER) {
  const exact = ratio[k] * 100 / entries;
  pct[k] = Math.floor(exact);
  rem[k] = exact - pct[k];
}
const short = 100 - ORDER.reduce((s, k) => s + pct[k], 0);
for (const k of [...ORDER].sort((a, b) => rem[b] - rem[a]).slice(0, Math.max(short, 0))) pct[k]++;

console.log(`條目 ${entries} ｜ 節 ${sections} ｜ A ${grade.A} B ${grade.B} C ${grade.C} ｜ 爭議 ${dispute} ｜ TODO ${todo} ｜ 鏈接 ${links}`);
console.log(`性價比 極高 ${ratio['極高']}（${pct['極高']}%） 高 ${ratio['高']}（${pct['高']}%） 一般 ${ratio['一般']}（${pct['一般']}%）`);
console.log('');

const EDITS = [
  ['README.md', '首屏條目數', /(\d+) 條建議/g, `${entries} 條建議`],
  ['README.md', '條目徽章', /%E6%9D%A1%E7%9B%AE-(\d+)%20%E6%9D%A1/g, `%E6%9D%A1%E7%9B%AE-${entries}%20%E6%9D%A1`],
  ['README.md', '證據分級徽章', /A%20(\d+)%20%C2%B7%20B%20\d+%20%C2%B7%20C%20\d+/g, `A%20${grade.A}%20%C2%B7%20B%20${grade.B}%20%C2%B7%20C%20${grade.C}`],
  ['README.md', '文獻鏈接徽章', /-(\d+)%20%E6%9D%A1%E9%93%BE%E6%8E%A5/g, `-${links}%20%E6%9D%A1%E9%93%BE%E6%8E%A5`],
  ['README.md', '怎麼讀裡的 A 級數', /大型試驗的 (\d+) 條/g, `大型試驗的 ${grade.A} 條`],
  ['README.md', '怎麼讀裡的極高條數', /勾選性價比「極高」，得到 (\d+) 條/g, `勾選性價比「極高」，得到 ${ratio['極高']} 條`],
  ['README.md', '證據分級段', /全書 (\d+) 條中 A 級 \d+ 條、B 級 \d+ 條、C 級 \d+ 條，另有 \d+ 條標註了爭議、\d+ 處/g,
    `全書 ${entries} 條中 A 級 ${grade.A} 條、B 級 ${grade.B} 條、C 級 ${grade.C} 條，另有 ${dispute} 條標註了爭議、${todo} 處`],
  ['README.md', '性價比段', /全書 (\d+) 條中性價比極高 \d+ 條（\d+%）、高 \d+ 條（\d+%）、一般 \d+ 條（\d+%）/g,
    `全書 ${entries} 條中性價比極高 ${ratio['極高']} 條（${pct['極高']}%）、高 ${ratio['高']} 條（${pct['高']}%）、一般 ${ratio['一般']} 條（${pct['一般']}%）`],
  ['README.md', '正文文件數', /正文按節拆成 (\d+) 個文件/g, `正文按節拆成 ${sections} 個文件`],
  ['index.html', '五處描述', /(\d+) 條建議/g, `${entries} 條建議`],
  ['index.html', 'numberOfPages', /numberOfPages":(\d+)/g, `numberOfPages":${entries}`],
  ['index.html', '頁頭條目數', /\d+ 節 (\d+) 條/g, `${sections} 節 ${entries} 條`],
  ['index.html', '頁腳文件數', /下的 (\d+) 個文件/g, `下的 ${sections} 個文件`],
  ['tools/og.html', 'og 條目數', /<b>(\d+)<\/b> 條建議/g, `<b>${entries}</b> 條建議`],
  ['tools/og.html', 'og A 級數', /A 級證據 <b>(\d+)<\/b> 條/g, `A 級證據 <b>${grade.A}</b> 條`],
  ['tools/og.html', 'og 鏈接數', /<b>(\d+)<\/b> 條原始文獻鏈接/g, `<b>${links}</b> 條原始文獻鏈接`],
];

const texts = new Map();
const stale = [];
for (const [file, label, pattern, repl] of EDITS) {
  const text = texts.get(file) ?? read(file);
  const found = [...text.matchAll(pattern)];
  if (found.length === 0) throw new Error(`${file} 裡找不到「${label}」，模式：${pattern}`);
  const old = found[0][1];
  // 用函數做替換值，免得替換串裡的 $ 被當成分組引用
  const updated = text.replace(pattern, () => repl);
  texts.set(file, updated);
  if (updated === text) {
    console.log(`  ${file} ${label}：${old}（未變）`);
    continue;
  }
  stale.push(`${file} ${label}`);
  console.log(`  ${file} ${label}：${old} -> ${CHECK ? '過時' : `已更新（${found.length} 處）`}`);
}

if (CHECK) {
  if (stale.length === 0 && !badWho.length) {
    console.log('\n統計數字檢查通過');
    process.exit(0);
  }
  if (stale.length === 0) process.exit(1);   // 只有人群標籤的錯，上面已經報過
  console.log(`\n有 ${stale.length} 處統計數字過時。本地跑 node tools/sync-stats.mjs（順帶重出 og.png），然後提交。`);
  process.exit(1);
}

for (const [file, text] of texts) if (text !== read(file)) writeFileSync(join(ROOT, file), text);

// ② 重算交叉引用對照表：插入或刪除條目會讓後面的「第 X 條」集體錯位，而錯位後的條號
// 往往仍在範圍內（2026-09-19 第 7 節那 6 處就是），只有把「引用 → 目標標題」攤開入庫，
// diff 才看得見。放在截圖之前，--no-screenshot 也要跑到
const runTool = name => spawnSync(process.execPath, [join(ROOT, 'tools', name)], { stdio: 'inherit' }).status;
console.log('');
if (runTool('check-refs.mjs') !== 0) throw new Error('check-refs.mjs 失敗');
console.log('提交前掃一眼 docs/引用对照.md 的 diff：條號沒動而「指向的條目」變了，就是被順延撞歪的引用。');

// 最近更新：檢索頁的「新增」「改過」標記，工作區裡沒提交的改動算今天
console.log('');
if (runTool('updates.mjs') !== 0) throw new Error('updates.mjs 失敗');

// ③ 說人話檢查只提示不中斷：數字已經同步完了，卡在這裡反而讓人以為統計沒更新。CI 裡它會紅
console.log('');
if (runTool('check-plain.mjs') !== 0) console.log('上面列出的說人話不合格，提交前改掉（規則見 tools/check-plain.mjs 文件頭）。');

if (process.argv.includes('--no-screenshot')) process.exit(0);

// ④ 截 og.png
const CHROME_PATHS = [
  process.env.CHROME,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];
const chrome = CHROME_PATHS.find(p => p && existsSync(p));
if (!chrome) throw new Error('找不到 Chrome，設環境變量 CHROME 指到它，或者加 --no-screenshot 跳過截圖');

// 每次用全新的 user-data-dir：否則 Chrome 會拿緩存裡的舊 og.html 渲染，截出來還是舊數字。
// --screenshot 必須給絕對路徑：給相對路徑 Chrome 什麼都不寫，還照樣返回 0
const profile = mkdtempSync(join(tmpdir(), 'og-shot-'));
const target = join(ROOT, 'og.png');
const startedAt = Date.now();
// Chrome 把「xxx bytes written」這類信息寫在 stderr 上，不是報錯，直接丟掉
spawnSync(chrome, [
  '--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--window-size=1200,630', `--user-data-dir=${profile}`, `--screenshot=${target}`,
  pathToFileURL(join(ROOT, 'tools', 'og.html')).href,
], { stdio: 'ignore' });
rmSync(profile, { recursive: true, force: true });

// 自檢：文件是這次寫的、大小在正常區間。過了這兩關就不必再打開圖看，省一次讀圖的開銷
const png = statSync(target);
if (png.mtimeMs < startedAt - 1000) throw new Error('og.png 沒有被這次運行寫入，截圖失敗了');
if (png.size < 120 * 1024 || png.size > 400 * 1024) throw new Error(`og.png 大小異常（${png.size} 字節），正常在 120KB 到 400KB，打開看一眼是不是渲染壞了`);
console.log(`\nog.png 已重出：${png.size} 字節，自檢通過。改過 tools/og.html 的版式才需要打開圖確認。`);
