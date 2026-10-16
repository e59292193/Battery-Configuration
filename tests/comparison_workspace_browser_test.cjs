/** Optional Playwright regression: module navigation, collapsed steps and real report exports.
 * PLAYWRIGHT_PATH=/path/to/playwright node tests/comparison_workspace_browser_test.cjs /path/to/chromium
 * REPORT_TEST_DIR=/path saves generated XLSX/PDF/HTML fixtures for manual inspection. */
const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.argv[2]||'chromium',args:['--no-sandbox']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('file://'+path.resolve(__dirname,'../public/index.html'));await page.waitForTimeout(1500);
 const settle=()=>page.waitForTimeout(120);
 assert.equal(await page.locator('#calcStepsCard').evaluate(e=>e.open),false);
 for(const id of ['tabPower','tabCapacity','tabDcUps']){
  await page.locator('#calcStepsCard summary').click();assert.equal(await page.locator('#calcStepsCard').evaluate(e=>e.open),true);
  const target=id==='tabPower'?'tabCapacity':id;await page.locator('#'+target).click();
  assert.equal(await page.locator('#calcStepsCard').evaluate(e=>e.open),false,'mode entry folds steps');
 }
 await page.locator('#tabComparison').click();
 assert.equal(await page.locator('#calculatorModule').isVisible(),false);
 assert.equal(await page.locator('#batteryComparisonSection').isVisible(),true);
 assert.equal(await page.locator('#batteryComparisonSection').evaluate(e=>e.parentElement.id==='calculatorModule'),false);
 for(const mode of ['power','capacity','dc']){
  await page.locator('#cmpSourceMode').selectOption(mode);await settle();
  assert.equal(await page.evaluate(()=>calcMode),mode);assert.equal(await page.locator('#batteryComparisonSection').isVisible(),true);
  await page.locator('#cmpExportReportBtn').click();
  assert.equal(await page.evaluate(()=>exportModalState.kind),'comparison');
  for(const lang of ['en','zh']){
   await page.locator(`input[name="exportLangRadio"][value="${lang}"]`).check({force:true});await settle();
   const data=await page.evaluate(l=>getExportDataset(l),lang);
   assert.ok(data.rows.some(r=>r.id==='cmp_weight'));assert.ok(data.rows.some(r=>r.id==='cmp_scope'&&r.required));
   assert.equal(data.rows.find(r=>r.id==='cmp_weight').znValue,await page.evaluate(()=>fmt(lastComparisonResult.znNi.totalWeight,1)+' kg'));
   if(lang==='en')assert.ok(!/[\u4e00-\u9fff]/.test(JSON.stringify(data.rows)),'English report data has no Chinese');
  }
  await page.locator('#exportClearBtn').click();
  assert.ok((await page.locator('#exportPreviewPaper').innerText()).includes('计算校核状态'),'clear cannot remove required checks');
  await page.locator('#exportBriefBtn').click();assert.ok(await page.locator('#exportPreviewPaper td').count()>10);
  await page.locator('#exportModalCloseBtn').click();
 }
 await page.locator('#cmpEditConfigBtn').click();assert.equal(await page.locator('#calculatorModule').isVisible(),true);
 assert.equal(await page.locator('#calcStepsCard').evaluate(e=>e.open),false);
 // Controlled, valid Z38 case. Preserve status/limits even in brief reports.
 await page.evaluate(()=>{setCalcMode('power');acLoadMode='constant';for(const [id,v] of Object.entries({batteryModel:'8XNFZ38',cellsPerString:288,blocksPerGroupDisplay:36,numberOfStrings:1,upsRatingKva:20,epv:1.35,temperature:25,agingFactor:1,designMargin:1,systemVoltage:480,vvUpsLower:384,vvUpsUpper:576}))document.getElementById(id).value=v;backupTimeMin=15;cmpManualSeriesBlocks=null;cmpManualParallelStrings=null;recalculate();openComparisonModule();});
 await page.locator('#cmpExportReportBtn').click();
 await page.locator('input[name="exportLangRadio"][value="en"]').check({force:true});await page.locator('#exportBriefBtn').click();
 const before=await page.evaluate(()=>({snapshot:exportModalState.comparisonSnapshot.res.leadAcid.totalBlocks,rows:getSelectedExportRows().length}));
 await page.evaluate(()=>{cmpManualSeriesBlocks=60;recalculate();});
 assert.equal(await page.evaluate(()=>getExportDataset('en').rows.find(r=>r.id==='cmp_blocks').laValue),String(before.snapshot),'open report is a stable snapshot');
 // Generate real files through the existing modal download path.
 for(const format of ['xlsx','html','pdf']){
  await page.locator(`input[name="exportFormatRadio"][value="${format}"]`).check({force:true});
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.locator('#exportDownloadBtn').click()]);
  assert.ok(download.suggestedFilename().startsWith('Battery_Comparison_'));
  const dest=process.env.REPORT_TEST_DIR;
  if(dest){fs.mkdirSync(dest,{recursive:true});await download.saveAs(path.join(dest,download.suggestedFilename()));}
 }
 await page.locator('#exportModalCloseBtn').click();
 await page.evaluate(()=>openExportModal('comparison'));
 await page.locator('input[name="exportLangRadio"][value="en"]').check({force:true});
 const failed=await page.locator('#exportPreviewPaper').innerText();assert.ok(failed.includes('Not compliant'));assert.ok(failed.includes('paused until both schemes pass'));
 await page.locator('input[name="exportFormatRadio"][value="pdf"]').check({force:true});
 {const [download]=await Promise.all([page.waitForEvent('download',{timeout:60000}),page.locator('#exportDownloadBtn').click()]);if(process.env.REPORT_TEST_DIR)await download.saveAs(path.join(process.env.REPORT_TEST_DIR,'Full_'+download.suggestedFilename()));}
 await page.locator('#exportModalCloseBtn').click();
 // Existing configuration export must not inherit the comparison dataset.
 await page.locator('#cmpEditConfigBtn').click();await page.locator('#exportTableBtn').click();
 assert.equal(await page.evaluate(()=>exportModalState.kind),'configuration');assert.ok(!(await page.evaluate(()=>exportModalState.allRows.some(r=>r.id==='cmp_weight'))));
 await page.locator('#exportModalCloseBtn').click();await page.locator('#tabComparison').click();
 for(const lang of ['en','zh'])for(const width of [1440,390]){
  await page.evaluate(l=>applyLanguage(l),lang);await page.setViewportSize({width,height:1000});await page.evaluate(()=>setAiOpen(false));await settle();
  assert.equal(await page.locator('#batteryComparisonSection').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,`${lang}/${width} comparison overflow`);
  assert.equal(await page.locator('.module-tabs').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'navigation overflow');
  if(width===390){
   await page.locator('#cmpExportReportBtn').click();await settle();
   assert.equal(await page.locator('#exportModalBody').evaluate(e=>e.scrollWidth>e.clientWidth+1),false,'mobile export body overflow');
   const order=await page.evaluate(()=>({downloadBottom:document.getElementById('exportDownloadBtn').getBoundingClientRect().bottom,previewTop:document.getElementById('exportPreviewPane').getBoundingClientRect().top}));
   assert.ok(order.downloadBottom<=order.previewTop,'mobile export controls must not overlap preview');
   await page.locator('#exportModalCloseBtn').click();
  }

 }
 assert.deepEqual(errors,[]);console.log('Comparison workspace passed: independent navigation, default folds, 3 sources, bilingual stable report snapshots, mandatory warnings, real XLSX/HTML/PDF downloads, configuration-export isolation and responsive widths.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
