/** Optional real-browser regression. npm install --no-save playwright, or set PLAYWRIGHT_PATH.
 * Run: node tests/ui_browser_test.cjs [absolute/path/to/chromium]
 * No external services or AI calls are made. */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const path=require('path'),fs=require('fs'),assert=require('node:assert/strict');
(async()=>{
 const b=await chromium.launch({executablePath:process.argv[2]||'chromium',args:['--no-sandbox']});
 try{
  const page=await b.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('file://'+path.resolve(__dirname,'../public/index.html'));await page.waitForTimeout(1200);
  const settle=()=>page.waitForTimeout(120);
  async function noChinese(label){
   const leak=await page.evaluate(()=>{
    const a=[],w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);
    while(w.nextNode()){const n=w.currentNode,e=n.parentElement;if(!e||e.closest('script,style,input,textarea,pre,code,#savedConfigsList,#exportPreviewPaper,#exportParamsListContainer,[data-user-content]'))continue;
    // Ordinary assistant/user responses are intentionally left untouched.
    if(e.closest('#aiMsgs')&&!e.closest('.msg-sys-tip'))continue;
    if(e.getClientRects().length&&/[\u4e00-\u9fff]/.test(n.data))a.push(n.data.trim());}
    return a;});assert.deepEqual(leak,[],label+': untranslated UI');
  }
  let states=0;
  for(const lang of ['zh','en','zh','en']){await page.evaluate(l=>applyLanguage(l),lang);await settle();if(lang==='en')await noChinese('language toggle');}
  for(const mode of ['power','capacity','dc'])for(const duty of [false,true]){
   await page.evaluate(({mode,duty})=>{setCalcMode(mode);if(mode==='dc')setDcLoadMode(duty?'duty':'constant');else {acLoadMode=duty?'duty':'constant';if(duty)loadAcDutyPreset(2);}recalculate();}, {mode,duty});await settle();await noChinese(mode+'/'+duty);states++;
  }
  await page.evaluate(()=>{setCalcMode('power');acLoadMode='constant';document.getElementById('batteryModel').value='8XNFZ38';document.getElementById('cellsPerString').value=288;document.getElementById('blocksPerGroupDisplay').value=36;document.getElementById('numberOfStrings').value=1;document.getElementById('upsRatingKva').value=20;document.getElementById('epv').value=1.35;document.getElementById('temperature').value=25;document.getElementById('agingFactor').value=1;document.getElementById('designMargin').value=1;backupTimeMin=15;document.getElementById('systemVoltage').value=480;document.getElementById('vvUpsLower').value=384;document.getElementById('vvUpsUpper').value=576;cmpLeadAcidModelId=null;cmpManualSeriesBlocks=null;cmpManualParallelStrings=null;recalculate();});await settle();
  assert.equal(await page.locator('#cmpValidity').getAttribute('data-status'),'pass');
  await page.locator('#cmpLaParallelStrings').fill('2');await settle();assert.equal(await page.evaluate(()=>lastComparisonResult.leadAcid.parallelStrings),2);
  await page.locator('#cmpResetLaBtn').click();await settle();assert.equal(await page.evaluate(()=>lastComparisonResult.leadAcid.parallelStrings),1);
  await page.locator('#cmpLaSeriesBlocks').fill('60');await settle();assert.equal(await page.locator('#cmpValidity').getAttribute('data-status'),'fail');assert.ok(!(await page.locator('#cmpMetrics').innerText()).includes('relative to VRLA'));
  await page.locator('#cmpResetLaBtn').click();await settle();
  await page.evaluate(()=>{document.getElementById('epv').value=2;backupTimeMin=1500;recalculate();});await settle();await noChinese('boundary warnings');
  await page.evaluate(()=>{document.getElementById('epv').value=.5;backupTimeMin=.1;recalculate();});await settle();await noChinese('low cutoff / short duration warnings');
  await page.evaluate(()=>{contextAttached=true;renderContextChips();});await settle();await noChinese('attached configuration context');
  // Native AI-owned controls and validation must be English; assistant/user prose is untouched.
  await page.evaluate(()=>{const div=document.createElement('div');div.id='configLanguageTest';document.getElementById('aiMsgs').appendChild(div);renderConfigCard('<CONFIG_JSON>'+JSON.stringify({cellsPerString:7})+'</CONFIG_JSON>',div);});
  await page.locator('#configLanguageTest [data-act="apply"]').click();
  assert.ok(!(await page.locator('#configLanguageTest').innerText()).match(/[\u4e00-\u9fff]/),'AI config validation stays English');
  await page.evaluate(()=>document.getElementById('configLanguageTest').remove());
  await page.evaluate(()=>{document.getElementById('aiSettingsModal').style.display='';syncSettingsUI();});await settle();await noChinese('AI settings');
  await page.evaluate(()=>{document.getElementById('aiSettingsModal').style.display='none';document.getElementById('aiRulesPanel').open=true;refreshRulesPanel();});await settle();assert.ok((await page.locator('#aiRulesContent').innerText()).includes('ENGINEERING RULES'));
  // User text, saved names and uploaded filenames must not be translated.
  await page.evaluate(()=>{const node=document.createElement('div');node.id='userTextTest';node.dataset.userContent='true';node.textContent='项目 阶段 电池型号';document.body.appendChild(node);document.getElementById('aiInput').value='我的电池项目';refreshInterfaceLanguage();});
  assert.equal(await page.locator('#userTextTest').innerText(),'项目 阶段 电池型号');assert.equal(await page.locator('#aiInput').inputValue(),'我的电池项目');
  await page.evaluate(()=>document.getElementById('userTextTest').remove());
  await page.evaluate(()=>{document.getElementById('epv').value=1.35;backupTimeMin=15;recalculate();});await settle();
  await page.locator('#cmpEngineeringDetails').evaluate(el=>el.open=true);await page.locator('#cmpDutyDetails').evaluate(el=>el.open=true);
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await settle();const overflow=await page.locator('#batteryComparisonSection').evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,`comparison overflows at ${width}px`);}
  assert.deepEqual(errors,[],'No uncaught page errors');
  console.log(`Browser regression passed: ${states} mode/duty states, language round trips, warnings, settings, controls, user text and 1440/390px widths.`);
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exit(1)});
