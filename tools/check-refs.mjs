// 交叉引用對照表：把正文裡每一處「第 X 條」引用解析成它實際指向的條目標題，
// 寫進 docs/引用对照.md。那份文件入库，所以插入或删除条目导致引用指向变化时，
// git diff 會直接把變化擺出來——條號沒動而標題變了，就是錯位。
//
//   node tools/check-refs.mjs            # 重新生成對照表（sync-stats.mjs 會自動調用）
//   node tools/check-refs.mjs --check    # 只校驗不寫文件，有失效引用則退出碼 1（CI 用）
//   node tools/check-refs.mjs --suspect  # 額外列出措辭和目標標題對不上的，誤報多，排查歷史遺留時用
//
// 為什麼需要它：條號是位置依賴的，正文裡的引用只記了位置不記內容。2026-09-19
// 在第 7 節發現 6 處指錯（醫療救助指到低保、救助站指錯條），全都在條號範圍內，
// 越界檢查一條都抓不到。
// 注意：切行一律用 /\r?\n/，不能用 '\n'。book/ 下的文件行尾不統一（有 CRLF 有 LF），
// 而 JS 正則的 . 不匹配 \r（CR 也算行終止符，這點和 Python、Perl 不一樣），
// 留著 \r 會讓 /^### (\d+)\. (.*)$/ 在 CRLF 文件上一條都匹配不到。
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

// 節內的裸引用（「見第 8 條」）只在這幾個欄位裡找：來源欄裡的「第 N 條」幾乎都是
// 法條條款號，掃進來全是誤報。
const FIELDS = /^- (說人話|收益|備註|成本)：/;
// 但帶節號的跨節引用（「見第 11 節第 16 條」）不會和法條混淆，來源欄裡也有，一併掃。
// book/26 第 103 條那處「日誌留存見第 11 節第 16 條」就寫在來源欄裡，差點漏掉。
const CROSS_FIELDS = /^- (說人話|收益|備註|成本|來源)：/;

const files = readdirSync(resolve(ROOT, 'book')).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
// docs/ 下的長文也掃。它們和節首引言一樣，長期不在掃描範圍內：條號被順延撞歪時
// --check 照常顯示通過，對照表的 diff 裡也看不到這些引用。2026-09-21 清點時
// 三篇長文裡有 23 處「第 X 節第 Y 條」，一處都沒被查過。
// 只取 docs/ 根下的 .md。子目錄 docs/核实记录/ 不掃：那些文件記的是當時的核實過程，
// 裡面的條號是歷史狀態，不該跟著正文走。對照表自己也排除掉。
const docs = readdirSync(resolve(ROOT, 'docs')).filter(f => f.endsWith('.md') && f !== '引用对照.md' && f !== '引用對照.md').sort();

// 先把每節的條目標題讀出來：sections[節號] = { file, titles: { 條號: 標題 } }
const sections = new Map();
for (const f of files) {
  const num = Number(f.slice(0, 2));
  const titles = new Map();
  for (const line of readFileSync(resolve(ROOT, 'book', f), 'utf8').split(/\r?\n/)) {
    const m = /^### (\d+)\. (.*)$/.exec(line);
    if (m) titles.set(Number(m[1]), m[2].trim());
  }
  sections.set(num, { file: f, titles });
}

// 一處引用可能寫成「第 3、10、11 條」，拆成多個條號。也認區間寫法「第 11 到 14 條」
// 「第 5 到第 10 條」：這種寫法原先整處都匹配不上，等於沒掃，全書有 5 處這麼寫的。
const RANGE = /^\s*(\d+)\s*(?:到|至)\s*第?\s*(\d+)\s*$/;
// 返回 [條號, 是不是區間展開來的]。區間指的是一整塊條目（「泄憤那幾條」「平台義務
// 那幾條」），沒法給塊裡每一條都配一個錨點，所以展開出來的條號免驗錨點——它們仍然
// 進對照表，被順延撞歪時靠 diff 裡標題變化來發現。
const nums = s => {
  const out = [];
  for (const part of s.split(/[、,]/)) {
    const r = RANGE.exec(part);
    if (r) {
      const [a, b] = [Number(r[1]), Number(r[2])];
      if (b >= a && b - a <= 30) for (let i = a; i <= b; i++) out.push([i, true]);
      continue;
    }
    const n = Number(part.trim());
    if (Number.isFinite(n)) out.push([n, false]);
  }
  return out;
};
// 條號那一段的寫法：「3」「3、10」「11 到 14」「5 到第 10」
const SPEC = '[\\d、,\\s]+?(?:(?:到|至)\\s*第?\\s*\\d+)?';

const out = [];
const problems = [];
const suspects = [];
const weak = [];
let total = 0;

// 掃描單元：book/ 下每節一個，docs/ 下每篇長文一個。
const targets = [
  ...files.map(f => ({ f, dir: 'book', isDoc: false })),
  ...docs.map(f => ({ f, dir: 'docs', isDoc: true })),
];

for (const { f, dir, isDoc } of targets) {
  const num = isDoc ? 0 : Number(f.slice(0, 2));
  const self = isDoc ? null : sections.get(num);
  const lines = readFileSync(resolve(ROOT, dir, f), 'utf8').split(/\r?\n/);
  const rows = [];
  // cur 是當前所在條目的條號，0 表示還沒進條目（book 的節首引言、docs 的任何位置）。
  // unit 是「出處」列顯示的名字：條目寫「第 N 條」，節首寫「節首」，長文寫最近的小標題。
  let cur = 0;
  let unit = isDoc ? '開頭' : '節首';

  // 引用前面那句話往往就寫著它想指什麼（「醫療救助（見第 11 條）」），把整個分句
  // 列出來，人工掃對照表時不用翻正文就能判斷指對沒有。
  // 取到最近的句讀為界而不是固定字數——固定 14 字曾讓好幾處正確引用看起來可疑
  // （「一氧化碳見第 18 條，燒燙傷見第 13 條」截斷後只剩「氧化碳」對著「燙傷」）。
  const ctxOf = (line, idx) => {
    const before = line.slice(0, idx);
    let start = -1;
    for (const p of ['。', '；', '！', '？', '：']) start = Math.max(start, before.lastIndexOf(p));
    return before.slice(start + 1).slice(-44).replace(/\|/g, '｜');
  };
  // 驗錨點時用的窗口比上面這個窄：只取引用所在的那個逗號分句。整句那麼寬的窗口裡
  // 「自己」「公司」這類常見詞很容易和別的條目標題偶然重合，錨點就成了假的——
  // 2026-09-20 第 31 節插條目，第 1 條備註裡「……的貸款見本節第 15 條」被順延撞到
  // 新條目「在家給境外公司遠程幹活……個稅自己報」上，整句窗口裡兩個逗號之外的
  // 「你自己還」撞上標題裡的「個稅自己報」，--check 報了通過。
  // 分句太短時（「……，見第 11 條」這種，窗口只剩一個「見」字）往前再退一個分句，
  // 否則會把本來正確的引用誤判成裸條號。
  // 頓號和引號、括號都不算分句邊界：「含糖飲料、加工肉（本節第 3 條）」的錨點隔著頓號，
  // 「為『比別人強一檔』而加的預算見本節第 24 條」的錨點在引號裡，切了都會誤傷。
  const CLAUSE = ['。', '；', '！', '？', '：', '，'];
  const narrowOf = (line, idx) => {
    const before = line.slice(0, idx);
    const cut = s => {
      let start = -1;
      for (const p of CLAUSE) start = Math.max(start, s.lastIndexOf(p));
      return { head: s.slice(0, start + 1), tail: s.slice(start + 1) };
    };
    const last = cut(before);
    if (last.tail.replace(/[見按同和依據參照的在]/g, '').length >= 4) return last.tail.slice(-24);
    return (cut(last.head.slice(0, -1)).tail + last.tail).slice(-24);
  };
  // 引用後面的文字也算錨點：「第 16 條（借條和擔保）」這種把關鍵詞寫在條號之後
  // 取到引用後的第一個句讀為止（最多 40 字）。不能用固定字符數：「見第 1 節第 7、8、
  // 14、17、18、19、23、24、29 條（血壓、血糖…）」這種長條號串會把標註擠出窗口。
  const afterOf = (line, idx) => {
    const rest = line.slice(idx).replace(new RegExp(`^第\\s*\\d+\\s*節?第?\\s*(?:${SPEC})?\\s*條`), '');
    const end = rest.search(/[。；！？]/);
    return (end === -1 ? rest : rest.slice(0, end)).slice(0, 40).replace(/\|/g, '｜');
  };

  lines.forEach((line, i) => {
    if (isDoc) {
      const h = /^#{1,6}\s+(.+?)\s*$/.exec(line);
      if (h) { unit = h[1].slice(0, 24); return; }
    } else {
      const t = /^### (\d+)\. (.*)$/.exec(line);
      if (t) { cur = Number(t[1]); unit = `第 ${cur} 條`; return; }
    }
    // 條目正文只掃那幾個欄位（來源欄的「第 N 條」多是法條條款號）。節首引言和長文
    // 正文是普通段落，匹配不上欄位前綴，整行放行——它們原先就是這樣被靜默跳過的。
    const inEntry = !isDoc && cur > 0;
    if (inEntry ? !CROSS_FIELDS.test(line) : !line.trim()) return;

    // 相對指路（「見下一條」「罰則見上一條」）一律禁掉：它不帶條號，插入條目時跟著
    // 整體平移，撞歪了對照表的 diff 也看不出來，--check 的裸條號檢查更是掃不到它。
    // 2026-09-20 一次掃描就查出三處早就指錯的：HPV 疫苗條的「見下一條」指到了乳腺癌
    // 篩查（該指宮頸癌篩查），揚言條的「罰則見上一條」指到了念頭條，失業登記條的
    // 「上一條不籤主動辭職」指到了存證據條。排除「最後一條」「之後一條腿」這類誤命中。
    for (const m of line.matchAll(/(?<![最之以])(上一條|下一條|前一條|後一條|上面那條|上面這條|前面那條)/g)) {
      problems.push(`${f}:${i + 1} ${unit}用了相對指路「${m[1]}」——改成「第 N 條（錨點詞）」`);
    }

    // 跨節：第 N 節第 X 條
    for (const m of line.matchAll(new RegExp(`第\\s*(\\d+)\\s*節第\\s*(${SPEC})\\s*條`, 'g'))) {
      const target = sections.get(Number(m[1]));
      for (const [x, range] of nums(m[2])) {
        const title = target?.titles.get(x);
        rows.push({ from: unit, range, ref: `第 ${m[1]} 節第 ${x} 條`, title, line: i + 1, ctx: ctxOf(line, m.index), narrow: narrowOf(line, m.index), after: afterOf(line, m.index) });
        if (!title) problems.push(`${f}:${i + 1} ${unit}引用「第 ${m[1]} 節第 ${x} 條」——該節沒有這一條`);
      }
    }

    // 長文裡沒有「本節」這個概念，裸的「第 N 條」在長文裡指的是法條條款號，不掃。
    if (isDoc) return;

    // 節內：掃所有「第 X 條」，不限引導詞——正文裡的寫法遠不止「見第 X 條」，還有
    // 「按第 1 條壓胸」「判斷方法同第 4 條」「先對照第 8 條」「和第 4 條二選一」，
    // 早先只認三種引導詞，這些全漏在掃描之外。來源欄整行不掃（全是法條條款號）。
    // 節首引言不受欄位限制：那裡的「第 N 條」是導讀（「第 9 條算錢」「第 2 條算讀書
    // 和壽命的關係」），同樣會被順延撞歪，同樣要進對照表。
    if (inEntry && !FIELDS.test(line)) return;
    const stripped = line.replace(new RegExp(`第\\s*\\d+\\s*節第\\s*${SPEC}\\s*條`, 'g'), '');
    for (const m of stripped.matchAll(new RegExp(`第\\s*(${SPEC})\\s*條`, 'g'))) {
      // 判定這是法條條款號還是條目引用。2026-09-21 之前的辦法是看前 16 個字裡有沒有
      // 「法」字，可是「辦法」「查法」「法律援助」「違法解除」都帶「法」，一大批真引用
      // 被連帶跳過。而且是靜默跳過：引用壓根不進對照表，--check 沒有可查的引用反而顯示
      // 「通過」，只能靠引用總數少了才發現。一次全量掃描查出 12 處這樣的引用。
      // 現在按兩條明確的判據跳過：
      //   ① 緊挨著「第 N 條」的是引文標記——《…》、〔…〕、「14 號」、「該解釋」，
      //      或者以法規名收尾（「治安管理處罰法第 26 條」）；
      // 只認「緊挨著」，不按前 N 個字的模糊窗口，也不拿「是不是句首」當判據——條目引用
      // 照樣會頂在句首（「第 4 條的救助站免費管吃住」「第 7 條那張『立刻去醫院』的清單」）。
      // 代價是法條引文必須自帶文件名：一句一條往下列時要寫「該解釋第 11 條」，不能寫
      // 「……的法院命令。第 11 條講的是取證」靠上一句撐著。這本來也是正文的自足性要求。
      const tail = stripped.slice(0, m.index).replace(/\s+$/, '');
      const CITE = /(《[^》]*》|〔[^〕]*〕|\d+\s*號|（第\s*\d+[A-Z]?\s*章）|第\s*\d+[A-Z]?\s*章|該(?:解釋|意見|辦法|規定|條例|規例|守則|指引|通知|法)|[^\s，。；：、（）「」]{0,8}(?:法|條例|規例|守則|指引|辦法|規定|準則|細則|公約))$/;
      if (CITE.test(tail)) continue;
      for (const [x, range] of nums(m[1])) {
        const title = self.titles.get(x);
        rows.push({ from: unit, range, ref: `本節第 ${x} 條`, title, line: i + 1, ctx: ctxOf(stripped, m.index), narrow: narrowOf(stripped, m.index), after: afterOf(stripped, m.index) });
        // 節內引用超出本節條目數的，多半是法條條款號被誤當成條目引用，列出來人工看
        if (!title) problems.push(`${f}:${i + 1} ${unit}引用「第 ${x} 條」——本節只有 ${self.titles.size} 條（可能是法條條款號）`);
        if (inEntry && x === cur) problems.push(`${f}:${i + 1} 第 ${cur} 條引用了它自己`);
      }
    }
  });

  // 能不能自動驗證這處引用指對了：引用前後的文字裡，有沒有一段字也出現在目標條目
  // 標題裡。有 → 這處引用自帶錨點，改動導致錯位時會被察覺；沒有 → 它是個裸條號
  // （「實際算法可以看第 34 條」），錯了也看不出來，需要補一個顯式標註。
  // 兩個漢字的重合太容易偶然發生（「自己」「公司」「時間」），所以按長度和距離分級：
  // 整句裡連著三個漢字對上（「含糖飲料」「居民醫保」）算實錨點；只有兩個漢字對上時，
  // 要求它落在引用所在的分句裡才算——隔著兩個逗號的「你自己還」撞上標題裡的
  // 「個稅自己報」，就是 2026-09-20 那處漂移蒙過檢查的原因。
  const longest = (text, title) => {
    let best = 0;
    for (let i = 0; i < text.length; i++) {
      for (let n = 1; i + n <= text.length; n++) {
        const seg = text.slice(i, i + n);
        if (!/^[一-龥]+$/.test(seg)) break;
        if (!title.includes(seg)) break;
        best = Math.max(best, n);
      }
    }
    return best;
  };
  // 數字和英文串也是錨點：12356、AED、CT、BMI、LPR 這些常常就是引用要指的東西
  const token = (text, title) => (text.match(/[0-9A-Za-z]{2,}/g) ?? []).some(t => title.includes(t));
  for (const r of rows) {
    if (!r.title || r.range) continue;
    const wide = r.ctx + r.after;
    if (token(wide, r.title) || longest(wide, r.title) >= 3) continue;
    if (longest(r.narrow + r.after, r.title) >= 2) continue;
    // 只在分句之外撞上兩個字的，按弱錨點單獨列：修法和裸條號一樣是補顯式標註。
    const list = longest(wide, r.title) >= 2 ? weak : suspects;
    list.push(`${f}:${r.line} ${r.from} →「${r.ref}」${r.title.slice(0, 20)}…　…${r.ctx}【${r.ref}】${r.after}…`);
  }

  if (!rows.length) continue;
  total += rows.length;
  out.push(`## ${isDoc ? 'docs/' : ''}${basename(f, '.md')}\n`);
  out.push('| 出處 | 引用 | 指向的條目 | 引用處的上下文 |');
  out.push('| --- | --- | --- | --- |');
  for (const r of rows) {
    const title = r.title ? r.title : '**指向不存在的條目**';
    out.push(`| ${r.from} | ${r.ref} | ${title} | …${r.ctx}… |`);
  }
  out.push('');
}

const body = [
  '# 交叉引用對照表',
  '',
  '本文件由 `node tools/check-refs.mjs` 生成，不要手改。',
  '',
  '正文裡的「第 X 條」只記條號不記內容，插入或刪除條目會讓後面的引用集體錯位，',
  '而錯位後的條號往往仍在範圍內，光查越界抓不到。所以把每處引用**實際指向的標題**',
  '攤開寫在這裡併入庫：改完條目重新生成，`git diff` 裡凡是條號沒動而標題變了的，',
  '就是被順延撞歪的引用。',
  '',
  '掃描範圍：`book/` 下每節的條目正文和節首引言，加上 `docs/` 下的長文。長文裡沒有',
  '「本節」，裸的「第 N 條」一律當法條跳過，所以長文引用要寫全「第 X 節第 Y 條」。',
  '「出處」列裡，條目寫「第 N 條」，節首寫「節首」，長文寫最近的那個小標題。',
  '',
  '另一道保險是**錨點**：每處引用的前後文裡都得有一個詞和目標條目標題對得上',
  '（「醫療救助見第 11 條」裡的「醫療救助」，或顯式寫成「見第 16 條（借條和擔保）」）。',
  '`node tools/check-refs.mjs --check` 會把沒有錨點的裸條號判為失敗——那種引用一旦',
  '被撞歪，對照表的 diff 也看不出異常，只能靠錨點兜住。區間引用（「見第 8 節第 11 到',
  '14 條」）是例外：它指的是一整塊條目，沒法給塊裡每條都配錨點，只靠 diff 兜。',
  '',
  '錨點算不算數按長度和距離判：整句裡連著三個漢字和標題對上（「含糖飲料」「居民醫保」），',
  '或者引用所在的那個逗號分句裡有兩個漢字對上，才算實錨點；只在分句之外撞上兩個常見漢字',
  '（「自己」「公司」）的，按沒有錨點處理。這道加嚴是 2026-09-20 補的：第 31 節插條目時',
  '「……的貸款見本節第 15 條」被順延撞到新條目「在家給境外公司遠程幹活……個稅自己報」上，',
  '隔著兩個逗號的「你自己還」冒充了錨點，`--check` 當時報的是通過。',
  '',
  `共 ${total} 處引用。`,
  '',
  ...out,
].join('\n');

if (problems.length) {
  console.log('需要人工確認：');
  for (const p of problems) console.log('  ' + p);
  console.log('');
}

// 這個啟發式當年誤報率極高（中文裡「未遂之後的長期結局見第 30 條」指向「念頭一冒出來
// 先告訴身邊的一個人」完全正確，卻一個字都不重疊），288 處能報出 159 處；後來全書 345 處
// 引用逐一補了錨點，這兩類現在正常情況下都應該是 0，報出來就是真有一處該補標註。
// 但它只保證「錯位能被察覺」，不保證「錯位一定被攔下」：模擬把節內引用整體順延一條，
// 能當場攔下的約七成，剩下的（相鄰兩條講同一件事、標題共用詞）仍要靠對照表的 diff。
if (process.argv.includes('--suspect') && suspects.length) {
  console.log(`引用處的措辭和目標標題對不上（${suspects.length} 處，誤報很多，僅供人工排查參考）：`);
  for (const s of suspects) console.log('  ' + s);
  console.log('');
}

if (process.argv.includes('--suspect') && weak.length) {
  console.log(`錨點只在分句之外對上（${weak.length} 處，多半是常見詞偶然撞上，等於沒有錨點）：`);
  for (const s of weak) console.log('  ' + s);
  console.log('');
}

if (CHECK_ONLY) {
  const fatal = problems.filter(p => p.includes('該節沒有這一條') || p.includes('引用了它自己') || p.includes('相對指路'));
  for (const p of fatal) console.log('  ' + p);
  // 裸條號（引用前後沒有一個詞和目標標題對得上）同樣算失敗：這種引用一旦被條目順延
  // 撞歪，誰也看不出來。修法是補個錨點——「見第 16 條（借條和擔保）」，
  // 括號裡的詞取自目標條目標題即可。
  if (suspects.length) {
    console.log(`${suspects.length} 處引用是裸條號，錯了看不出來，請補錨點（跑 --suspect 看清單）：`);
    for (const s of suspects.slice(0, 10)) console.log('  ' + s.split('　')[0]);
    if (suspects.length > 10) console.log(`  …另有 ${suspects.length - 10} 處`);
  }
  // 弱錨點同樣算失敗：整句裡只有兩個常見漢字對上、還隔著分句，等於沒有錨點。
  if (weak.length) {
    console.log(`${weak.length} 處引用的錨點只在分句之外偶然對上，等於沒有錨點，請補顯式標註（跑 --suspect 看清單）：`);
    for (const s of weak.slice(0, 10)) console.log('  ' + s.split('　')[0]);
    if (weak.length > 10) console.log(`  …另有 ${weak.length - 10} 處`);
  }
  const bad = fatal.length + suspects.length + weak.length;
  console.log(bad ? `共 ${bad} 處要處理` : `引用檢查通過：${total} 處全部指向正確，且都帶錨點`);
  process.exit(bad ? 1 : 0);
}

writeFileSync(resolve(ROOT, 'docs/引用对照.md'), body, 'utf8');
console.log(`已寫入 docs/引用对照.md，共 ${total} 處引用`);
