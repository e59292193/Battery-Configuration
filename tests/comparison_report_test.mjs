import fs from 'node:fs';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const part=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b,html.indexOf(a)));
const E=new Function(`let calcMode='power', currentLang='en';
${part('// DATA LAYER','// UI HELPERS')}
${part('// CAPACITY ENGINE','// CAPACITY PANEL RENDERER')}
${part('// AC RECOMMENDER & DUTY CYCLE ENGINE','// DC UPS ENGINE & RENDERER')}
${part('// DC UPS ENGINE & RENDERER','// CALCULATION STEPS RENDERER')}
${part('// LEAD-ACID BENCHMARK ENGINE & COMPARISON MODULE','function updateComparisonSection')}
return {getFactorMultiplier,calculate,calculateCapacity,calculateDc,calculateLeadAcidComparison,sizeDutyBySection,LEAD_ACID_MODEL_MAP,BATTERY_MODEL_MAP,
mode:m=>{calcMode=m},duty:(ac,dc)=>{acLoadMode=ac;dcLoadMode=dc},dcSteps:s=>{dcDutyCycleList=s}};`)();
const input={batteryModelId:'8XNFZ38',upsRatingKva:20,systemVoltage:480,powerFactor:.9,inverterEfficiency:.95,agingFactor:1,designMargin:1,epv:1.35,backupTimeMin:15,cellsPerString:288,blocksPerGroup:36,numberOfStrings:1,temperature:25,voltageRangePercent:20};

const reportCode=part('// COMPARISON REPORT DATA','// END COMPARISON REPORT DATA');
const createReport=new Function('snapshot','lang','getFactorMultiplier', `
let exportModalState={comparisonSnapshot:snapshot};
const fmt=(v,n=1)=>Number.isFinite(v)?v.toLocaleString('en-US',{maximumFractionDigits:n}):'—';
${reportCode}
return getComparisonExportDataset(lang);`);
let checked=0;
const base={batteryModelId:'8XNFZ38',upsRatingKva:20,systemVoltage:480,powerFactor:.9,inverterEfficiency:.95,agingFactor:1,designMargin:1,epv:1.35,backupTimeMin:15,cellsPerString:288,blocksPerGroup:36,numberOfStrings:1,temperature:25,voltageRangePercent:20};
for(const mode of ['power','capacity','dc']) {
 E.mode(mode);E.duty('constant','constant');
 const input={...base,dcSystemVoltage:110,dcVoltMin:90,dcVoltMax:160,dcConstLoadValue:10,dcConstLoadUnit:'A',dcConstTimeMin:15};
 if(mode==='dc')Object.assign(input,{cellsPerString:80,blocksPerGroup:10,epv:1.2});
 const active=mode==='dc'?E.calculateDc(input):mode==='capacity'?E.calculateCapacity(input):E.calculate(input);
 const snapshot={res:E.calculateLeadAcidComparison(input,active),inputs:input,mode,active,capturedAt:'2026-10-16T00:00:00Z'};
 for(const lang of ['zh','en']) {
  const data=createReport(snapshot,lang,E.getFactorMultiplier);
  assert.equal(new Set(data.rows.map(r=>r.id)).size,data.rows.length,'unique stable row IDs');
  for(const id of ['status','issues','source','scope','temperature_scope'])assert.ok(data.rows.find(r=>r.id==='cmp_'+id)?.required,'mandatory report safeguards');
  assert.equal(data.rows.find(r=>r.id==='cmp_blocks').znValue,String(snapshot.res.znNi.totalBlocks));
  assert.equal(data.rows.find(r=>r.id==='cmp_blocks').laValue,String(snapshot.res.leadAcid.totalBlocks));
  if(lang==='en')assert.ok(!/[\u4e00-\u9fff]/.test(JSON.stringify(data.rows)),'English rows contain no Chinese');
  checked++;
 }
 if(mode==='power') {
  const failing={...snapshot,res:E.calculateLeadAcidComparison(input,active,{manualSeriesBlocks:60})};
  const r=createReport(failing,'en',E.getFactorMultiplier);
  assert.ok(r.rows.find(r=>r.id==='cmp_weight_delta').value.includes('paused'));
  assert.ok(r.rows.find(r=>r.id==='cmp_status').laValue.includes('Not compliant'));
 }
}
assert.equal(createReport(null,'en',E.getFactorMultiplier),null);
console.log(`Comparison report passed: ${checked} bilingual engine snapshots, mandatory warnings, stable IDs, exact configuration values, missing snapshot and failed-scheme conclusions.`);
