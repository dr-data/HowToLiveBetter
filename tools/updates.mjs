// 最近更新：翻 git 歷史，逐條比對 book/ 的條目，記下每條是哪天新增的、正文最後一次改是哪天，
// 寫進根目錄的 updates.json，檢索頁拿它標「新增」「改過」和做「最近更新」篩選。
//
//   node tools/updates.mjs            # 重新生成 updates.json（sync-stats.mjs 會自動調用）
//   node tools/updates.mjs --check    # 只比對不寫，過時了退出碼 1（CI 用，要 fetch-depth: 0）
//
// 不用提交信息：那是寫給維護者的（「同步導覽」「補錨點」），讀者看不懂。
// 條目按標題認，不按條號認：刪一條，後面的條號全變。標題按規矩只許加字，所以前後兩版
// 標題對不上時再按標題和正文的相似度配對，配不上的才算新增或刪除。
// 只有讀者看得見的正文變了才算「改過」：標題、成本、說人話、收益、證據等級、備註。
// 來源欄、成本標籤、條號順延、「第 N 條（錨點）」裡的條號和錨點詞變了都不算，不然天天滿屏「改過」。
// 只走 main 的第一父提交：本地 merge --no-ff 合進來的 PR 算在合併那天。
// 起算日之前的條目一律當老條目，不標新增。日期按北京時間。
// --check 只比對「哪些條目、新增還是改過、改了哪幾欄」，不比日期：PR 在 CI 上是臨時合併提交，
// 日期必然和本地生成時差一點。
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './lib/book.mjs';

const CHECK = process.argv.includes('--check');
const SINCE = '2026-10-01';
const OUT = 'updates.json';
const FIELDS = ['標題', '成本', '說人話', '收益', '證據等級', '備註'];

const day = sec => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date(sec * 1000));
const git = (args, input) => {
  const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: ROOT, input, maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失敗：${r.stderr}`);
  return r.stdout;
};

// ---------- 解析 ----------
// 引用裡的條號和錨點會隨順延和補錨點變，抹掉再比
const norm = s => s.replace(/\s+/g, '')
  .replace(/第\d+(節|條)/g, '第#$1')
  .replace(/(第#條)（[^（）]{1,30}）/g, '$1');

const FIELD_MAP = { 成本: '成本', 说人话: '說人話', 說人話: '說人話', 收益: '收益', 证据等级: '證據等級', 證據等級: '證據等級', 备注: '備註', 備註: '備註' };

function parse(text) {
  const out = [];
  let sec = null, e = null;
  for (const line of text.split(/\r?\n/)) {
    let m;
    if ((m = /^# (\d+)\. /.exec(line))) { sec = m[1]; continue; }
    if ((m = /^### (\d+)\. (.+)$/.exec(line)) && sec) {
      e = { key: `${sec}-${m[1]}`, f: { 標題: m[2].trim() } };
      out.push(e); continue;
    }
    if (!e) continue;
    if ((m = /^- (成本|说人话|說人話|收益|证据等级|證據等級|备注|備註)：(.*)$/.exec(line))) e.f[FIELD_MAP[m[1]]] = m[2].trim();
  }
  for (const x of out) x.n = Object.fromEntries(FIELDS.map(k => [k, norm(x.f[k] ?? '')]));
  return out;
}

// 中文按相鄰兩字切片算相似度
const grams = s => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
function dice(a, b) {
  if (!a.size || !b.size) return 0;
  let n = 0; for (const x of a) if (b.has(x)) n++;
  return 2 * n / (a.size + b.size);
}

// 前一版的條目（帶追蹤信息）和這一版配對，返回這一版的追蹤列表
function step(prev, cur, date) {
  const next = new Array(cur.length);
  const byTitle = new Map();
  prev.forEach((p, i) => { const k = p.e.n.標題; if (!byTitle.has(k)) byTitle.set(k, []); byTitle.get(k).push(i); });
  const used = new Set();
  // ① 標題一字不差：同名的優先配同一個節號
  cur.forEach((c, j) => {
    const cand = (byTitle.get(c.n.標題) ?? []).filter(i => !used.has(i));
    if (!cand.length) return;
    const sec = c.key.split('-')[0];
    const i = cand.find(i => prev[i].e.key.split('-')[0] === sec) ?? cand[0];
    used.add(i); next[j] = { ...prev[i], e: c };
  });
  // ② 剩下的按標題和正文相似度配
  const restP = prev.map((p, i) => i).filter(i => !used.has(i));
  const restC = cur.map((c, j) => j).filter(j => !next[j]);
  if (restP.length && restC.length) {
    const sig = e => ({ t: grams(e.n.標題), b: grams(e.n.說人話 + e.n.收益) });
    const sp = new Map(restP.map(i => [i, sig(prev[i].e)]));
    const pairs = [];
    for (const j of restC) {
      const sc = sig(cur[j]);
      for (const i of restP) {
        const s = Math.max(dice(sc.t, sp.get(i).t), dice(sc.b, sp.get(i).b) * 0.9);
        if (s >= 0.5) pairs.push([s, i, j]);
      }
    }
    pairs.sort((a, b) => b[0] - a[0]);
    for (const [, i, j] of pairs) {
      if (used.has(i) || next[j]) continue;
      used.add(i); next[j] = { ...prev[i], e: cur[j] };
    }
  }
  // ③ 剩下的按同節同條號 1:1 配對（繁簡轉換與香港本地化改寫保持條號不變）
  const byKeyP = new Map(prev.map((p, i) => [p.e.key, i]));
  cur.forEach((c, j) => {
    if (next[j]) return;
    const i = byKeyP.get(c.key);
    if (i !== undefined && !used.has(i)) {
      used.add(i); next[j] = { ...prev[i], e: c };
    }
  });
  cur.forEach((c, j) => { if (!next[j]) next[j] = { e: c, added: date, changed: null, fields: [] }; });
  return next;
}

// 光改措辭不算「改過」：2026-10-14 全書審校一次改了五百多條的說人話和備註，全標上讀者會被淹沒。
// 算數的是：標題或證據等級變了；欄裡的數字變了（新數據、改正的數字）；或者一欄加長了不少（補了新內容）。
const nums = s => (s.match(/\d+(?:\.\d+)?/g) ?? []).sort().join();
function real(k, a, b) {
  if (a === b) return false;
  if (k === '標題' || k === '證據等級') return true;
  return nums(a) !== nums(b) || b.length - a.length >= Math.max(60, a.length / 4);
}

// 配對之後逐欄比，記下改了哪幾欄；同一天改了幾輪的，欄目並在一起
function advance(prev, cur, date) {
  const next = step(prev, cur, date);
  const old = new Map(prev.map(p => [p.id, p.e]));
  for (const t of next) {
    if (t.id === undefined) { t.id = SEQ++; continue; }
    const o = old.get(t.id);
    const diff = FIELDS.filter(k => real(k, o.n[k], t.e.n[k]));
    if (!diff.length || t.added === date) continue;
    t.fields = t.changed === date ? [...new Set([...t.fields, ...diff])] : diff;
    t.changed = date;
  }
  return next;
}
let SEQ = 0;

// ---------- 取歷史 ----------
const sinceTs = Math.floor(new Date(`${SINCE}T00:00:00+08:00`).getTime() / 1000);
const base = git(['rev-list', '-1', '--first-parent', `--before=${sinceTs}`, 'HEAD']).toString().trim();
if (!base) throw new Error(`找不到 ${SINCE} 之前的提交。CI 上 checkout 要加 fetch-depth: 0`);
const log = git(['log', '--first-parent', '--reverse', '--diff-merges=first-parent', '--name-only',
  '--format=@%H %ct', `${base}..HEAD`, '--', 'book/']).toString();
const commits = [];
for (const line of log.split('\n')) {
  if (line.startsWith('@')) { const [h, t] = line.slice(1).split(' '); commits.push({ h, date: day(Number(t)), files: [] }); continue; }
  if (/^book\/.+\.md$/.test(line.trim())) commits.at(-1).files.push(line.trim());
}
const baseFiles = git(['ls-tree', '--name-only', base, 'book/']).toString().split('\n').filter(f => f.endsWith('.md'));

// 一次 cat-file --batch 取完所有要的版本，Windows 上逐個起 git 進程太慢
const reqs = [...baseFiles.map(f => `${base}:${f}`), ...commits.flatMap(c => c.files.map(f => `${c.h}:${f}`))];
const blob = git(['cat-file', '--batch'], reqs.join('\n') + '\n');
const got = new Map();
let pos = 0;
for (const r of reqs) {
  const nl = blob.indexOf(10, pos);
  const head = blob.subarray(pos, nl).toString();
  pos = nl + 1;
  if (head.endsWith(' missing')) { got.set(r, null); continue; }
  const size = Number(head.split(' ')[2]);
  got.set(r, blob.subarray(pos, pos + size).toString('utf8'));
  pos += size + 1;
}

// ---------- 逐版比對 ----------
const files = new Map(baseFiles.map(f => [f, got.get(`${base}:${f}`)]));
const snapshot = () => [...files.keys()].sort().flatMap(f => files.get(f) ? parse(files.get(f)) : []);
let track = advance([], snapshot(), null);
for (const c of commits) {
  for (const f of c.files) files.set(f, got.get(`${c.h}:${f}`));
  track = advance(track, snapshot(), c.date);
}
// 工作區裡還沒提交的改動算今天：sync-stats 在提交前跑，生成的就是提交後的樣子
const disk = readdirSync(join(ROOT, 'book')).filter(f => f.endsWith('.md')).map(f => `book/${f}`);
const dirty = disk.some(f => readFileSync(join(ROOT, f), 'utf8').replace(/\r\n/g, '\n') !== files.get(f)?.replace(/\r\n/g, '\n'))
  || [...files.keys()].some(f => files.get(f) && !disk.includes(f));
if (dirty) {
  files.clear();
  for (const f of disk) files.set(f, readFileSync(join(ROOT, f), 'utf8'));
  track = advance(track, snapshot(), day(Date.now() / 1000));
}

// ---------- 輸出 ----------
const items = {};
for (const t of track) {
  if (t.added) items[t.e.key] = { added: t.added };
  else if (t.changed) items[t.e.key] = { changed: t.changed, fields: FIELDS.filter(k => t.fields.includes(k)) };
}
const keys = Object.keys(items).sort((a, b) => {
  const [x1, y1] = a.split('-').map(Number), [x2, y2] = b.split('-').map(Number);
  return x1 - x2 || y1 - y2;
});
// 一條一行，diff 讀得懂
const json = `{"since":"${SINCE}","items":{\n${keys.map(k => `${JSON.stringify(k)}:${JSON.stringify(items[k])}`).join(',\n')}\n}}\n`;

const nAdd = keys.filter(k => items[k].added).length, nChg = keys.length - nAdd;
console.log(`最近更新：${SINCE} 起新增 ${nAdd} 條、改過 ${nChg} 條（比對了 ${commits.length} 個提交${dirty ? '加工作區' : ''}）`);

const strip = s => JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(s).items)
  .map(([k, v]) => [k, v.added ? 'added' : v.fields.join()])));
const old = existsSync(join(ROOT, OUT)) ? readFileSync(join(ROOT, OUT), 'utf8') : '';
if (CHECK) {
  if (old && strip(old) === strip(json)) { console.log('updates.json 檢查通過'); process.exit(0); }
  console.log('updates.json 過時了。本地跑 node tools/sync-stats.mjs（或 node tools/updates.mjs），然後提交。');
  process.exit(1);
}
if (old.replace(/\r\n/g, '\n') !== json) writeFileSync(join(ROOT, OUT), json);
