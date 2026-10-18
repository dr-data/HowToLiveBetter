// Manual generator for the 34 Hong Kong generalized chapters. No GitHub Actions.
// Usage: node hk/general/build.mjs [--check]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const source=JSON.parse(fs.readFileSync(path.join(dir,'catalog.json'),'utf8'));
const labels=["健康與安全","健康生活習慣","精神與精力管理","時間與工作效率","金錢與消費","健康迷思與產品","經濟困難與支援","個人安全與權益","法律風險與責任","伴侶與婚姻","科技與網絡責任","創業與營商","緊急情況","帳戶與資訊安全","租屋與置業","慢性病管理","長者照顧","育兒規劃","僱傭及工傷","新生兒照顧","外遊與旅遊安全","休閒與情緒","學習及技能","看病與醫療服務","親人離世後的安排","經營網站及平台","懷孕及分娩","外貌與健康","重大生活變故","學童身心健康","成年後的不同選擇","海外升學","殘疾與康復","家居用藥安全"];
const check=process.argv.includes('--check');
const issues=[];
if(!Array.isArray(source.items)||source.items.length!==765)issues.push('預期 765 項');
const seen=new Set();
const geo=/(?:中國|中国|內地|内地|大陸|大陆|人民幣|人民币|國務院|国务院|全國|全国|公安|社保|醫保|医保|公積金|公积金|123\d{2,3})/;
for(const item of source.items||[]){
  if(seen.has(item.id))issues.push('重複 ID '+item.id);seen.add(item.id);
  if(!/^G\d{2}-\d{3}$/.test(item.id))issues.push('無效 ID '+item.id);
  for(const k of ['title','advice','example','review_status','reference_url','reference_label']){
    if(!item[k]||typeof item[k]!=='string')issues.push('缺少 '+item.id+'.'+k);
  }
  if(geo.test([item.title,item.advice,item.example].join(' ')))issues.push('案例涉及其他地區制度 '+item.id);
  if(!item.reference_url?.startsWith('https://'))issues.push('參考連結格式有誤 '+item.id);
}
function chapter(no){
  const chapterNum=String(no).padStart(2,'0');
  const items=source.items.filter(x=>Number(x.id.slice(1,3))===no);
  return [
    '# '+chapterNum+'　'+labels[no-1],
    '',
    '> 本章收錄 '+items.length+' 項香港繁體中文通用生活建議草稿。例子以香港生活情境表述，不作地區制度比較。相關法律、醫療及政策細節尚未經逐項獨立核證，請按最新官方資料確認。',
    '',
    '[← 通用生活指南總目錄](../README.md)　｜　[香港專題入口](../../README.md)　｜　[搜尋網頁](../../index.html)',
    '',
    ...items.flatMap(x=>[
      '## '+x.id+'　'+x.title,
      '',
      '**一般做法：** '+x.advice,
      '',
      '**香港生活情境：** '+x.example,
      '',
      '**審核狀態：** '+x.review_status,
      '',
      '**延伸查閱：** ['+x.reference_label+']('+x.reference_url+')（供查閱資訊，不代表該機構核證此條建議）',
      '',
    ]),
    '---',
    '',
    '**使用聲明：** 此處只供一般教育與參考。醫療、法律、社會福利、就業及財務事宜，請在採取行動前按最新官方資訊及合資格專業人士的建議確認。',
    ''
  ].join('\n');
}
const folder=path.join(dir,'book');
if(!check)fs.mkdirSync(folder,{recursive:true});
for(let n=1;n<=labels.length;n++){
  const dest=path.join(folder,String(n).padStart(2,'0')+'.md');
  const expected=chapter(n);
  if(check){if(!fs.existsSync(dest)||fs.readFileSync(dest,'utf8')!==expected)issues.push('章節需更新 '+dest)}
  else fs.writeFileSync(dest,expected,'utf8');
}
if(issues.length){console.error(issues.join('\n'));process.exitCode=1}
else console.log((check?'已核對':'已寫入')+' '+labels.length+' 章，'+source.items.length+' 項');
