// 「說人話」檢查：這一行是檢索頁卡片上最顯眼的一段，讀者多半隻看它。
// 2026-09-28 issue #42 抱怨文風 AI 味重，舉的第 1 節第 33 條一行裡寫了醫院數、
// 病例數、分組，還用了「另一頭」「產出」「乾淨的結局」這類要讀者自己翻譯的說法。
// 這些都是 CLAUDE.md 早就禁掉的寫法，只是沒有機器檢查，寫著寫著就回來了。
//
//   node tools/check-plain.mjs          # 列出所有不合格的說人話，有則退出碼 1（CI 用）
//   node tools/check-plain.mjs --stat     # 只按規則計數
//   node tools/check-plain.mjs --numbers  # 加查第 ③ 樣，人工排查用
//
// 默認查 ①②④，第 ③ 樣要加 --numbers 才查。它誤報太多，不進 CI：熱線號碼（120、12356）、
// 法律和金錢條目裡舉例用的金額（「借 1000 元」）都會被當成新數字，而這些是合法寫法。
// 檢查四樣：
// ① 長度：120 字以內（空格不算字）。
// ② 研究行話：統計縮寫、研究設計、樣本量。讀者關心方向和量級，不關心誰做的、做了多少人。
// ③ 新數字：說人話裡的每個阿拉伯數字都要在同一條的標題、成本或收益欄裡出現過。
//    說人話只翻譯收益欄，不許添數字。「四成多」「四分之一」這類漢字說法不查。
// ④ 抽象腔：要讀者自己翻譯一遍的比喻和套話，名單見 VAGUE。只收確實出過問題的詞，
//    寧可漏也別誤報，誤報多了大家就不看了。
// 切行用 /\r?\n/，理由見 check-refs.mjs 文件頭。
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STAT = process.argv.includes('--stat');
const NUMBERS = process.argv.includes('--numbers');
const MAX = 120;

const JARGON = [
  [/\b(HR|RR|OR|CI|RCT|OR值)\b/, '統計縮寫'],
  [/隊列|薈萃|綜述|隨機|對照組|安慰劑組|雙盲|樣本/, '研究設計'],
  [/\d[\d,.]*\s*(例|名受試者|名參與者|家醫院|項研究|篇研究|個國家)/, '樣本量'],
  [/那組|兩組|各組|組的人/, '分組'],
];
const VAGUE = ['另一頭', '產出', '乾淨的結局', '這條路沒有', '說到底', '本質上', '換句話說'];

// 數字按值比，不按字面比：「.28」和「0.28」、「11,523」和「1.15 萬」是同一個數。
function numbers(s) {
  return [...s.replace(/(\d),(\d{3})/g, '$1$2').matchAll(/(\d*\.?\d+)\s*(萬)?/g)]
    .map(m => Number(m[1]) * (m[2] ? 10000 : 1));
}
// 說人話裡的 n 算不算從收益欄的 p 翻譯過來的：四捨五入（45.6 → 46，5801 → 5800），
// 或者風險比換成降幅（0.72 → 低 28%，0.53 → 低 47%）。差 5% 以內都算。
function derived(n, p) {
  const near = (a, b) => a === b || Math.abs(a - b) <= 0.05 * Math.max(Math.abs(a), Math.abs(b));
  return near(n, p) || near(n / 100, p) || (p < 1 && near(n / 100, 1 - p)) || (p > 1 && p < 100 && near(n, 100 - p));
}

const bad = [];
const count = { 長度: 0, 行話: 0, 新數字: 0, 抽象腔: 0 };
let total = 0;

const files = readdirSync(resolve(ROOT, 'book')).filter(f => /^\d\d-.*\.md$/.test(f)).sort();
for (const f of files) {
  const sec = Number(f.slice(0, 2));
  const lines = readFileSync(resolve(ROOT, 'book', f), 'utf8').split(/\r?\n/);
  let no = 0, title = '', fields = {};
  const flush = () => {
    const plain = fields['說人話'];
    if (!no || plain == null) return;
    total++;
    const where = `第 ${sec} 節第 ${no} 條`;
    const problems = [];
    const len = [...plain.replace(/\s/g, '')].length;
    if (len > MAX) { problems.push(`${len} 字，超過 ${MAX}`); count.長度++; }
    const jar = JARGON.filter(([re]) => re.test(plain)).map(([re, name]) => `${name}「${plain.match(re)[0]}」`);
    if (jar.length) { problems.push(...jar); count.行話++; }
    if (NUMBERS) {
      const pool = numbers([title, fields['成本'] ?? '', fields['收益'] ?? ''].join(' '));
      const fresh = [...new Set(numbers(plain))].filter(n => !pool.some(p => derived(n, p)));
      if (fresh.length) { problems.push(`收益欄裡沒有的數字 ${fresh.join('、')}`); count.新數字++; }
    }
    const vague = VAGUE.filter(w => plain.includes(w));
    if (vague.length) { problems.push(`抽象說法「${vague.join('」「')}」`); count.抽象腔++; }
    if (problems.length) bad.push(`${f}  ${where}：${problems.join('；')}`);
  };
  for (const line of lines) {
    const h = line.match(/^### (\d+)\. (.*)$/);
    if (h) { flush(); no = Number(h[1]); title = h[2]; fields = {}; continue; }
    const m = line.match(/^- (說人話|成本|收益)：(.*)$/);
    if (m && no) fields[m[1]] = m[2];
  }
  flush();
}

if (!STAT) for (const b of bad) console.log(b);
console.log(`\n說人話共 ${total} 條，不合格 ${bad.length} 條：` +
  Object.entries(count).map(([k, v]) => `${k} ${v}`).join('，'));
if (bad.length && !STAT) process.exit(1);
