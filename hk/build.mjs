// 從 data.json 產生香港版 Markdown；不修改原著 book/ 及 docs/。
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
const source=JSON.parse(fs.readFileSync(path.join(root,'data.json'),'utf8'));
const slugs=["01-安全應急","02-醫療健康","03-勞工權益","04-社會保障","05-理財稅務","06-住屋租務","07-防騙消費","08-創業私隱","09-婚姻育兒","10-教育技能","11-旅遊出境","12-香港數據"];
const cats=Object.keys(source.categories);
const problems=[];
if(!Array.isArray(source.items) || source.items.length===0)problems.push('items 必須是非空陣列');
if(cats.length!==slugs.length)problems.push('主題數目與檔案 slug 不一致');
const seen=new Set();
for(const item of source.items||[]){
  if(seen.has(item.id))problems.push('重複條目 ID：'+item.id);
  seen.add(item.id);
  if(!cats.includes(item.category))problems.push('未知主題：'+item.id);
  for(const field of ['title','advice','example','source','url','verified']){
    if(!item[field]||typeof item[field]!=='string')problems.push(item.id+' 缺少 '+field);
  }
  if(!/^https:\/\//.test(item.url||''))problems.push(item.id+' 來源 URL 格式有誤');
  if (/(?:中國|中国|內地|内地|大陸|大陆|人民幣|人民币|高考|ICP\s*備案|ICP\s*备案)/.test([item.title,item.advice,item.example].join(' '))) problems.push(item.id+'：香港版案例不應引用其他地區制度作比較');
}
if(problems.length){console.error(problems.join('\n'));process.exit(1)}
function renderTopic(key){
  return [
    '# '+source.categories[key]+' '+key,
    '',
    '> 香港繁體中文版。資料核對：'+source.updated.slice(0,4)+' 年 '+Number(source.updated.slice(5,7))+' 月 '+Number(source.updated.slice(8,10))+' 日。政策、收費與數據會變動，以主管部門最新公布為準。本頁不取代法律、醫療或財務專業意見。',
    '',
    '[← 香港版總目錄](../README.md)　｜　[互動搜尋頁](../index.html)',
    '',
    ...source.items.filter(x=>x.category===key).flatMap(x=>[
      '## '+x.id+'　'+x.title,
      '',
      '**建議：** '+x.advice,
      '',
      '**香港例子：** '+x.example,
      '',
      '**官方來源：** ['+x.source+']('+x.url+')',
      '',
      '**最近核對：** '+x.verified,
      '',
    ]),
    '若發現資料已更新或有誤，歡迎在 [GitHub Issues](https://github.com/dr-data/HowToLiveBetter/issues) 提供官方來源。',
    ''
  ].join('\n');
}
const folder=path.join(root,'book');
if(!process.argv.includes('--check'))fs.mkdirSync(folder,{recursive:true});
for(let i=0;i<cats.length;i++){
  const p=path.join(folder,slugs[i]+'.md');
  const content=renderTopic(cats[i]);
  if(process.argv.includes('--check')){
    if(!fs.existsSync(p)||fs.readFileSync(p,'utf8')!==content)problems.push('待更新：'+p);
  }else fs.writeFileSync(p,content,'utf8');
}
if(problems.length){console.error(problems.join('\n'));process.exit(1)}
console.log('香港版：'+source.items.length+' 項，'+cats.length+' 章；'+(process.argv.includes('--check')?'已核對':'已產生'));
