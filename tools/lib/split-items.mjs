// 把一行寫到底的超長「收益 / 備註」和串成一行的「來源」，在換話題、換出處的地方拆成子條目。
// 起因是一條「收益」常常一整段一千多字（比如第 31 節第 1 條把十二條路的門檻寫在一行裡），
// 讀的時候是一整塊，找不到哪句講哪條路。
//
// 只改版式，不動正文的字：拆出來的塊按順序拼回去和原文逐字相同（來源欄丟掉的只是分隔用的「；」）。
// 正文 md 仍然一個字段一行，index.html 的按行解析、sync-stats 的鏈接計數都不受影響。
//
// 四個出口用同一套規則：EPUB、PDF 在構建時調 splitLongItems；檢索網頁和離線單文件在 index.html 裡
// 有一份同樣的 splitGain / splitSrc。**改這裡的規則要同步改 index.html 裡那份**，
// `node tools/check-split.mjs` 會拿全書逐條比對兩邊拆出來的結果。

export const GAIN_MIN_LEN = 300;  // 收益、備註短於這個字數的不拆
export const GAIN_MIN_CHUNK = 25; // 拆出來太短的塊並回上一塊

// 句號之後，下一句以這些開頭，就當作換了一條依據
export const GAIN_TOPIC_START = [
  /^[^，。「」《》：；（）的]{1,12}看(《|[^，。「」的]{0,10}(?:法|條例|規例)[：「（第])/, // 當兵看兵役法：/ 考公務員看《…》；排除「的」，免得「它看的是…療法（」被認進來
  /^《[^》]{2,40}》/,                                                 // 《某條例》……
  /^(?!該|本|此|這|同|上述|但|而|所以|因此|並且|也)[一-龥]{1,12}(?:法|條例|規例)(第[一二三四五六七八九十百零\dA-Z]+條|「)/, // 刑法第…條 / 僱傭條例第…條；「該辦法第五條」「但刑法第…條」是接著上文，不算
  /^(另一|另有一|還有一|再一|又一)(項|篇)/,                            // 另一項試驗
  /^(國內|國外|國內外|本地|香港|海外)也有/,
  /^案例[一二三四五六七八九十]/,
  /^(同一天|同一試驗|同一指南|同一指引|同一研究)/,
  /^(美國|英國|歐洲|世界衞生組織|世界衛生組織|WHO|香港|中國)[^，。]{0,20}(指南|指引|共識|建議|學會)/,
  /^(先說|再說|最後說|先看|再看|最後看)/,
  /^一(項|篇)[^，。]{0,20}(試驗|研究|綜述|分析|調查)/,
  /^(芬蘭|北歐|英國|美國|日本|韓國|瑞典|丹麥|挪威|德國|法國|澳大利亞|澳洲|加拿大|荷蘭|台灣|香港|上海|北京)[^，。]{0,25}(研究|數據庫|資料庫|試驗|隊列|調查)/,
];

// 收益、備註：按不在「」『』《》（）裡的句號切句，遇到換話題的句子另起一塊
export function splitGain(text) {
  if (!text || text.length < GAIN_MIN_LEN) return [text];
  const sentences = [];
  let buf = '', depth = 0;
  for (const c of text) {
    if ('「『《（'.includes(c)) depth++;
    else if ('」』》）'.includes(c)) depth = Math.max(0, depth - 1);
    buf += c;
    if (c === '。' && depth === 0) { sentences.push(buf); buf = ''; }
  }
  if (buf) sentences.push(buf);
  const chunks = [];
  for (const s of sentences) {
    if (chunks.length && GAIN_TOPIC_START.some(re => re.test(s))) chunks.push(s);
    else if (chunks.length) chunks[chunks.length - 1] += s;
    else chunks.push(s);
  }
  const out = [];
  for (const c of chunks) {
    if (out.length && c.length < GAIN_MIN_CHUNK) out[out.length - 1] += c;
    else out.push(c);
  }
  if (out.length > 1 && out[0].length < GAIN_MIN_CHUNK) out.splice(0, 2, out[0] + out[1]);
  return out;
}

// 來源：「；」串起來的若干條文獻，一條一行。和 index.html 原有的 splitSrc 同一條規則：
// 括號和引號裡的分號不算分隔符（法條原文裡有「……代理或者追認；……」）
export function splitSrc(text) {
  const parts = []; let buf = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if ('「『（'.includes(c)) depth++;
    if ('」』）'.includes(c)) depth = Math.max(0, depth - 1);
    const semi = c === '；' || (c === ';' && /\s/.test(text[i - 1] || '') && /\s/.test(text[i + 1] || ''));
    if (semi && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += c;
  }
  parts.push(buf);
  return parts.map(s => s.trim()).filter(Boolean);
}

// 子條目開頭像「1. 」會被 markdown 認成有序列表，轉義掉
const safe = s => s.replace(/^(\d+)([.)])(\s)/, '$1\\$2$3');

// 給 EPUB、PDF 用：把 md 裡的長字段改寫成「- 收益：」加一層子列表
export function splitLongItems(md) {
  return md.split('\n').map(line => {
    const m = line.match(/^(\s*)- (收益|備註|來源)：(.*)$/);
    if (!m) return line;
    const [, indent, label, body] = m;
    const chunks = label === '來源' ? splitSrc(body) : splitGain(body);
    if (chunks.length < 2) return line;
    return `${indent}- ${label}：\n` + chunks.map(c => `${indent}  - ${safe(c.trim())}`).join('\n');
  }).join('\n');
}
