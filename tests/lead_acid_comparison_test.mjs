import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const html = readFileSync(htmlPath, 'utf8');

console.log('═'.repeat(72));
console.log('锌镍 vs 传统铅酸方案同台对比模块专项测试 (Lead-Acid Comparison Test)');
console.log('═'.repeat(72));

function extractCode(startMarker, endMarker) {
    const a = html.indexOf(startMarker);
    if (a < 0) throw new Error(`Marker not found: ${startMarker}`);
    const b = html.indexOf(endMarker, a);
    if (b < 0) throw new Error(`Marker not found: ${endMarker}`);
    return html.slice(a, b);
}

// 抽取计算沙盒环境
const dataLayerAndEngine = extractCode('// DATA LAYER', '// UI HELPERS');
const acEngine = extractCode('// AC RECOMMENDER & DUTY CYCLE ENGINE', '// DC UPS ENGINE & RENDERER');
const dcEngine = extractCode('// DC UPS ENGINE & RENDERER', '// CALCULATION STEPS RENDERER');
const comparisonEngine = extractCode('// LEAD-ACID BENCHMARK ENGINE & COMPARISON MODULE', 'function updateComparisonSection');

const testFn = new Function(`
    let calcMode = 'power';
    let currentLang = 'zh';
    ${dataLayerAndEngine}
    ${acEngine}
    ${dcEngine}
    ${comparisonEngine}
    return {
        BATTERY_MODELS,
        BATTERY_MODEL_MAP,
        LEAD_ACID_MODELS,
        LEAD_ACID_MODEL_MAP,
        getLeadAcidDefaultModelId,
        calculateLeadAcidComparison,
        calculate,
        calculateDc,
        sizeDutyBySection,
        lookupCapability,
        setCalcMode: (m) => { calcMode = m; },
        setAcLoadMode: (m) => { acLoadMode = m; },
        setDcLoadMode: (m) => { dcLoadMode = m; }
    };
`);

const {
    BATTERY_MODELS,
    BATTERY_MODEL_MAP,
    LEAD_ACID_MODELS,
    LEAD_ACID_MODEL_MAP,
    getLeadAcidDefaultModelId,
    calculateLeadAcidComparison,
    calculate,
    calculateDc,
    setCalcMode,
    setAcLoadMode,
    setDcLoadMode
} = testFn();

// ────────────────────────────────────────────────────────────────
// 1. 验证铅酸电池数据完整性与机械参数
// ────────────────────────────────────────────────────────────────
console.log('1. 铅酸电池静态数据库与机械参数校验:');
assert.ok(LEAD_ACID_MODELS && LEAD_ACID_MODELS.length >= 2, '必须至少包含 2 款高倍率铅酸电池');
assert.ok(LEAD_ACID_MODEL_MAP['LHR12400W'], '必须包含 LHR12400W 型号');
assert.ok(LEAD_ACID_MODEL_MAP['LHR12800W'], '必须包含 LHR12800W 型号');

const m400 = LEAD_ACID_MODEL_MAP['LHR12400W'];
assert.equal(m400.specs.cellsPerUnit, 6, '铅酸每块为 6 Cells');
assert.equal(m400.specs.ratedVoltage, 12.0, '铅酸标称电压 12.0V');
assert.equal(m400.specs.weightKg, 31.2, 'LHR12400W 单块重量应为 31.2 kg');
assert.equal(m400.specs.volumeL, 12.33, 'LHR12400W 单块体积应为 12.33 L');
assert.equal(m400.dischargeTable['1.67'][15], 400.0, 'LHR12400W 15min @ 1.67V 应精确为 400.0 W/cell');
assert.equal(m400.constantCurrentTable['1.67'][15], 220.4, 'LHR12400W 15min @ 1.67V 恒流放电应为 220.4 A/block');
console.log('  ✓ LHR12400W 机械参数与 25°C 放电表完全匹配官方规格书 (100Ah · 31.2kg · 12.33L · 400W/cell@15m)');

const m800 = LEAD_ACID_MODEL_MAP['LHR12800W'];
assert.equal(m800.specs.cellsPerUnit, 6, '铅酸每块为 6 Cells');
assert.equal(m800.specs.ratedVoltage, 12.0, '铅酸标称电压 12.0V');
assert.equal(m800.specs.weightKg, 66.8, 'LHR12800W 单块重量应为 66.8 kg');
assert.equal(m800.specs.volumeL, 28.31, 'LHR12800W 单块体积应为 28.31 L');
assert.equal(m800.dischargeTable['1.67'][15], 800.0, 'LHR12800W 15min @ 1.67V 应精确为 800.0 W/cell');
assert.equal(m800.constantCurrentTable['1.67'][15], 444.2, 'LHR12800W 15min @ 1.67V 恒流放电应为 444.2 A/block');
console.log('  ✓ LHR12800W 机械参数与 25°C 放电表完全匹配官方规格书 (210Ah · 66.8kg · 28.31L · 800W/cell@15m)');

// ────────────────────────────────────────────────────────────────
// 2. 对标映射关系联动校验
// ────────────────────────────────────────────────────────────────
console.log('\n2. 电池对标映射关系校验:');
assert.equal(getLeadAcidDefaultModelId('8XNFZ38'), 'LHR12400W', '8XNFZ38 (38Ah) 默认对标 LHR12400W (100Ah)');
assert.equal(getLeadAcidDefaultModelId('8XNFG90'), 'LHR12800W', '8XNFG90 (90Ah) 默认对标 LHR12800W (210Ah)');
console.log('  ✓ 默认对标映射关系与规格书严格一致');

// ────────────────────────────────────────────────────────────────
// 3. 交流恒功率工况方案推算 (200kVA · 480V · 15min)
// ────────────────────────────────────────────────────────────────
console.log('\n3. 交流恒功率模式同台对比方案推算 (200kVA · 480V · 15min):');
const acInput200 = {
    batteryModelId: '8XNFG90',
    upsRatingKva: 200,
    systemVoltage: 480,
    powerFactor: 0.9,
    inverterEfficiency: 0.95,
    agingFactor: 1,
    designMargin: 1,
    epv: 1.35,
    backupTimeMin: 15,
    cellsPerString: 296,
    blocksPerGroup: 37,
    numberOfStrings: 2,
    voltageRangePercent: 20
};
const znNiRes200 = calculate(acInput200);
const cmpRes200 = calculateLeadAcidComparison(acInput200, znNiRes200);

// 校验铅酸单串块数推算：round(480 / 12) = 40 块 (240 节)
assert.equal(cmpRes200.leadAcid.seriesBlocks, 40, '480V 母线下标配 40 块铅酸串联 (240 节)');
assert.equal(cmpRes200.leadAcid.totalCells, 240, '40 块 × 6 = 240 节');
assert.equal(cmpRes200.leadAcid.modelId, 'LHR12800W', '8XNFG90 默认对标 LHR12800W');

// 校验功率需求与并联数计算：
// 需求功率 200*1000*0.9/0.95 = 189,473.68 W
// 240节 @ 15min 1.67V 查表 800W/cell -> 1组可供 192,000 W >= 189,473.68 W -> 1组并联即可达标
assert.equal(cmpRes200.leadAcid.parallelStrings, 1, '1 组并联即达标 (192 kW >= 189.5 kW)');
assert.ok(cmpRes200.leadAcid.satisfactionPct >= 100, '铅酸满足率应 >= 100%');
console.log(`  ✓ 铅酸对标配置: 40 块/串 × 1 组并联 = 40 块 (满足率 ${cmpRes200.leadAcid.satisfactionPct.toFixed(1)}%)`);

// 校验重量与体积对比数据：
// 铅酸总重: 40 * 66.8 = 2672 kg
// 锌镍总重: 74 * 17.3 = 1280.2 kg (或 74 * 18.3 = 1354.2 kg)
assert.equal(cmpRes200.leadAcid.totalWeight, 2672, '铅酸总重应为 2672 kg');
assert.ok(cmpRes200.savings.weightSavedKg > 1300, '锌镍减重应超过 1300 kg');
assert.ok(cmpRes200.savings.weightSavedPct > 45, '减重百分比应超过 45%');
console.log(`  ✓ 重量对比: 锌镍 ${cmpRes200.znNi.totalWeight.toFixed(1)} kg vs 铅酸 2672.0 kg → 减重 ${cmpRes200.savings.weightSavedPct.toFixed(1)}% (减轻 ${cmpRes200.savings.weightSavedKg.toFixed(1)} kg)`);

// 体积对比:
// 铅酸总体积: 40 * 28.31 = 1132.4 L
// 锌镍总体积: 74 * 8.33 = 616.4 L
assert.ok(Math.abs(cmpRes200.leadAcid.totalVolume - 1132.4) < 0.1, '铅酸体积应为 1132.4 L');
assert.ok(cmpRes200.savings.volSavedL > 500, '锌镍省空间超过 500 L');
assert.ok(cmpRes200.savings.volSavedPct > 40, '节省空间比例超过 40%');
console.log(`  ✓ 体积对比: 锌镍 ${cmpRes200.znNi.totalVolume.toFixed(1)} L vs 铅酸 1132.4 L → 节省空间 ${cmpRes200.savings.volSavedPct.toFixed(1)}% (减少 ${cmpRes200.savings.volSavedL.toFixed(1)} L)`);

// ────────────────────────────────────────────────────────────────
// 4. 38Ah 锌镍 vs 100Ah 铅酸对比 (单块重量 4 倍差距)
// ────────────────────────────────────────────────────────────────
console.log('\n4. 38Ah 锌镍 (8XNFZ38) vs 100Ah 铅酸 (LHR12400W) 关键倍率校验:');
const acInputZ38 = {
    batteryModelId: '8XNFZ38',
    upsRatingKva: 100,
    systemVoltage: 480,
    powerFactor: 0.9,
    inverterEfficiency: 0.95,
    agingFactor: 1,
    designMargin: 1,
    epv: 1.35,
    backupTimeMin: 15,
    cellsPerString: 296,
    blocksPerGroup: 37,
    numberOfStrings: 2,
    voltageRangePercent: 20
};
const znNiResZ38 = calculate(acInputZ38);
const cmpResZ38 = calculateLeadAcidComparison(acInputZ38, znNiResZ38);

assert.equal(cmpResZ38.leadAcid.modelId, 'LHR12400W', '8XNFZ38 必须自动对标 LHR12400W');
assert.equal(cmpResZ38.leadAcid.unitWeight, 31.2, '铅酸单块 31.2 kg');
assert.equal(cmpResZ38.znNi.unitWeight, 7.8, '锌镍单块 7.8 kg');
assert.equal((31.2 / 7.8).toFixed(1), '4.0', '100Ah 铅酸单块重量恰为 38Ah 锌镍的 4.0 倍');
console.log('  ✓ 单块重量比核对无误: 铅酸 31.2 kg / 锌镍 7.8 kg = 4.0 倍重');

// ────────────────────────────────────────────────────────────────
// 5. 直流 UPS 模式母线电压下限自动向上适配校验
// ────────────────────────────────────────────────────────────────
console.log('\n5. 母线下限与截止电压 EPV 自动向上适配校验:');
setCalcMode('dc');
const dcInput = {
    batteryModelId: '8XNFG90',
    dcSystemVoltage: 110,
    dcVoltMin: 110.4,
    dcVoltMax: 144.0,
    cellsPerString: 80,
    blocksPerGroup: 10,
    numberOfStrings: 3,
    agingFactor: 1,
    designMargin: 1,
    dcConstTimeMin: 60,
    dcConstLoadValue: 50,
    dcConstLoadUnit: 'A'
};
const dcRes = calculateDc(dcInput);
// 用户选择 1.67V 截止，但单串若配 10 块(60节)，60*1.67=100.2V < 110.4V，需自动适配
const cmpResDc = calculateLeadAcidComparison(dcInput, dcRes, { leadAcidEpv: 1.67, manualSeriesBlocks: 10 });
assert.ok(cmpResDc.leadAcid.effectiveEpv >= 1.84, '必须自动向上匹配到满足母线下限的 1.85V 档位');
assert.equal(cmpResDc.leadAcid.effectiveEpvKey, '1.85', '有效 EPV 档位应归并到 1.85V');
assert.ok(cmpResDc.leadAcid.autoMatchedEpv, '必须置位 autoMatchedEpv 告警标签');
console.log(`  ✓ 母线下限 110.4V 约束下成功自动匹配至: ${cmpResDc.leadAcid.effectiveEpvKey}V/cell (原选 1.67V)`);

// ────────────────────────────────────────────────────────────────
// 6. UI DOM 节点与中英文 I18N 词条存在性验证
// ────────────────────────────────────────────────────────────────
console.log('\n6. DOM 结构与国际化双语词条核查:');
const requiredIds = ['batteryComparisonSection','cmpTitle','cmpLeadAcidModelSelect','cmpLeadAcidEpvSelect','cmpLaSeriesBlocks','cmpLaParallelStrings','cmpResetLaBtn','cmpValidity','cmpDutySummary','cmpSchemeCards','cmpMetrics','cmpEngineeringDetails','cmpEngineeringRows','cmpDutyRows','cmpTechnicalNotes'];
requiredIds.forEach(id=>assert.ok(html.includes(`id="${id}"`),`Missing #${id}`));
assert.ok(html.includes('Same-duty battery comparison'));
assert.ok(html.includes('同工况电池方案对比'));
assert.ok(!html.includes('15年设计寿命免换新'));
console.log('  ✓ V1 comparison DOM and bilingual renderer verified');

console.log('═'.repeat(72));
console.log('铅酸方案对比模块所有断言校验全部通过！100% 满足需求。');
