// 收益、備註、來源的拆分規則有兩份：tools/lib/split-items.mjs（EPUB、PDF）和 index.html 裡
// <split-rules> 那一段（檢索網頁、離線單文件）。這個腳本拿全書每一條比對兩邊拆出來的結果，
// 順帶查拆完能不能逐字拼回原文、加粗的 ** 有沒有被拆到兩塊裡。
// 用法：node tools/check-split.mjs     有問題退出碼 1
import { readdirSync } from 'node:fs';
import vm from 'node:vm';
import { read, readBook } from './lib/book.mjs';
import { splitGain, splitSrc } from './lib/split-items.mjs';

const html = read('index.html');
const m = html.match(/\/\/ <split-rules>[\s\S]*?\/\/ <\/split-rules>/);
if (!m) { console.error('index.html 裡找不到 // <split-rules> … // </split-rules> 這一段'); process.exit(1); }
const ctx = {};
vm.runInNewContext(`${m[0]}\nthis.splitGain = splitGain; this.splitSrc = splitSrc;`, ctx);

const { docFiles } = readBook();
const files = [...readdirSync(new URL('../book/', import.meta.url)).filter(f => f.endsWith('.md')).map(f => `book/${f}`), ...docFiles];
const problems = [];
let total = 0, split = 0;
for (const f of files) {
  read(f).split('\n').forEach((line, i) => {
    const mm = line.match(/^\s*- (收益|備註|來源)：(.*)$/);
    if (!mm) return;
    const [, label, body] = mm;
    const at = `${f}:${i + 1}（${label}）`;
    const lib = label === '來源' ? splitSrc(body) : splitGain(body);
    const web = label === '來源' ? ctx.splitSrc(body) : ctx.splitGain(body);
    total++;
    if (lib.length > 1) split++;
    if (JSON.stringify(lib) !== JSON.stringify(web)) problems.push(`${at}：split-items.mjs 拆成 ${lib.length} 塊，index.html 拆成 ${web.length} 塊`);
    if (label !== '來源' && lib.join('') !== body) problems.push(`${at}：拆完拼不回原文`);
    if (lib.length > 1 && lib.some(c => (c.match(/\*\*/g) || []).length % 2)) problems.push(`${at}：有一塊裡的 ** 不成對，加粗被拆開了`);
  });
}
for (const p of problems) console.log(p);
console.log(`${files.length} 個文件，${total} 個收益/備註/來源字段，拆開 ${split} 個，問題 ${problems.length} 處`);
process.exit(problems.length ? 1 : 0);
