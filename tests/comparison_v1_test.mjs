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
return {calculate,calculateCapacity,calculateDc,calculateLeadAcidComparison,sizeDutyBySection,LEAD_ACID_MODEL_MAP,BATTERY_MODEL_MAP,
mode:m=>{calcMode=m},duty:(ac,dc)=>{acLoadMode=ac;dcLoadMode=dc},dcSteps:s=>{dcDutyCycleList=s}};`)();
const input={batteryModelId:'8XNFZ38',upsRatingKva:20,systemVoltage:480,powerFactor:.9,inverterEfficiency:.95,agingFactor:1,designMargin:1,epv:1.35,backupTimeMin:15,cellsPerString:288,blocksPerGroup:36,numberOfStrings:1,temperature:25,voltageRangePercent:20};
let groups=0;
const check=(name,fn)=>{fn();groups++;console.log(' ✓ '+name)};
const compare=(i=input,opts={})=>E.calculateLeadAcidComparison(i,E.calculate(i),opts);
check('Both valid Z38 schemes can be compared',()=>{const c=compare();assert.equal(c.status,'pass');assert.equal(c.comparable,true);});
check('Manual undersizing blocks advantage conclusions',()=>{const i={...input,upsRatingKva:1000};const c=compare(i,{manualParallelStrings:1});assert.equal(c.status,'fail');assert.equal(c.comparable,false);assert.ok(c.leadAcid.issues.includes('load'));});
check('Inconsistent cells/block topology is never certified',()=>{const c=compare({...input,cellsPerString:290,blocksPerGroup:37});assert.ok(c.znNi.issues.includes('topology'));assert.equal(c.comparable,false);assert.equal(c.znNi.totalBlocks,37);});
check('Temperature fallback uses cells in ONE string, not all parallel strings',()=>{const c=compare({...input,numberOfStrings:3});assert.equal(c.znNi.equalizeVolt,288*1.9);assert.ok(Math.abs(c.znNi.floatVolt-288*1.85)<1e-9);});
check('No feasible VRLA voltage topology must fail explicitly',()=>{const c=compare({...input,upsVoltageLower:500,upsVoltageUpper:505});assert.equal(c.leadAcid.seriesFeasible,false);assert.equal(c.leadAcid.status,'fail');});
check('Automatic VRLA topology satisfies charge and discharge constraints',()=>{const c=compare({...input,upsVoltageLower:384,upsVoltageUpper:560});assert.equal(c.leadAcid.seriesBlocks,39);assert.equal(c.leadAcid.voltageOk,true);});
check('Lookup beyond supported time is not treated as verified',()=>{const c=compare({...input,backupTimeMin:1500});assert.equal(c.comparable,false);assert.ok(c.leadAcid.issues.includes('lookup'));});
check('Non-row VRLA cutoff snaps to a real row',()=>{const c=compare(input,{leadAcidEpv:1.72});assert.equal(c.leadAcid.effectiveEpvKey,'1.75');});
check('Missing results and zero demand cannot report a pass',()=>{assert.equal(E.calculateLeadAcidComparison(input,null).comparable,false);assert.equal(compare({...input,upsRatingKva:0}).comparable,false);});
check('G90 weight source conflict is explicit, not silently used for savings',()=>{const c=compare({...input,batteryModelId:'8XNFG90'});assert.ok(c.znNi.issues.includes('weightSource'));assert.equal(c.comparable,false);assert.equal(c.znNi.unitWeight,E.BATTERY_MODEL_MAP['8XNFG90'].specs.weightKg);});
check('Energy-mode manual Wh sets the SAME demand for both chemistries',()=>{E.mode('capacity');const i={...input,requiredEnergyMode:'manual',manualRequiredEnergy:50000};const r=E.calculateCapacity(i);const c=E.calculateLeadAcidComparison(i,r);assert.ok(c.leadAcid.satisfactionPct<1000);const expected=E.LEAD_ACID_MODEL_MAP.LHR12400W.dischargeTable['1.67'][15]*240*c.leadAcid.parallelStrings/r.totalRequiredPower*100;assert.ok(Math.abs(c.leadAcid.satisfactionPct-expected)<1e-8);E.mode('power');});
check('DC section sizing uses currentA AND identical aging/design factors',()=>{E.mode('dc');E.duty('constant','duty');const raw=[{currentA:10,durationMin:10},{currentA:80,durationMin:10}];E.dcSteps(raw);const i={...input,dcSystemVoltage:110,dcVoltMin:90,dcVoltMax:160,cellsPerString:80,blocksPerGroup:10,numberOfStrings:2,epv:1.2,agingFactor:1.2,designMargin:1.1};const r=E.calculateDc(i),c=E.calculateLeadAcidComparison(i,r);const row=E.LEAD_ACID_MODEL_MAP[c.leadAcid.modelId].constantCurrentTable[c.leadAcid.effectiveEpvKey];const expected=E.sizeDutyBySection(raw.map(st=>({load:st.currentA*1.2*1.1,durationMin:st.durationMin})),row);assert.ok(Math.abs(c.leadAcid.controlSection.requiredUnits-expected.requiredUnits)<1e-10);assert.ok(c.leadAcid.controlSection.requiredUnits>0);assert.equal(c.leadAcid.controlSection.section,2);});
console.log(`${groups} V1 engineering test groups passed`);
