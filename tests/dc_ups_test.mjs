import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const html = readFileSync(htmlPath, 'utf8');

function extractCode(startMarker, endMarker) {
    const a = html.indexOf(startMarker);
    if (a < 0) throw new Error(`Marker not found: ${startMarker}`);
    const b = html.indexOf(endMarker, a);
    if (b < 0) throw new Error(`Marker not found: ${endMarker}`);
    return html.slice(a, b);
}

// 抽取数据层、AC引擎及直流计算引擎
const dataLayer = extractCode('// DATA LAYER', '// UI HELPERS');
const acEngine = extractCode('// AC RECOMMENDER & DUTY CYCLE ENGINE', '// DC UPS ENGINE & RENDERER');
const dcEngine = extractCode('// DC UPS ENGINE & RENDERER', '// CALCULATION STEPS RENDERER');

const testFn = new Function(`
    ${dataLayer}
    ${acEngine}
    ${dcEngine}
    return {
        BATTERY_MODELS,
        BATTERY_MODEL_MAP,
        getRecommendedDcBlocks,
        calculateDc,
        setDcLoadMode,
        loadS2tPreset,
        applyDcPreset,
        getDcState: () => ({ dcLoadMode, dcDutyCycleList }),
        getRecommendedAcConfig,
        loadAcDutyPreset,
        getAcState: () => ({ acLoadMode, acDutyCycleList })
    };
`);

const {
    BATTERY_MODELS,
    BATTERY_MODEL_MAP,
    getRecommendedDcBlocks,
    calculateDc,
    setDcLoadMode,
    getDcState,
    getRecommendedAcConfig,
    loadAcDutyPreset,
    getAcState
} = testFn();

console.log('════════════════════════════════════════════════════════════════════════');
console.log('直流UPS模式 (DC UPS Mode) 专用测试 (无铅酸对比)');
console.log('════════════════════════════════════════════════════════════════════════');

// 1. 测试智能母线推荐算法
console.log('1. 测试智能母线块数推荐算法:');
const rec110 = getRecommendedDcBlocks(110.4, 144.0);
assert.equal(rec110.blocks, 10, '110V系统应推荐10块');
assert.equal(rec110.cells, 80, '10块对应80节');
assert.equal(rec110.cellDis.toFixed(2), '1.38', '单体放电截止应为 1.38V');
assert.equal(rec110.cellChg.toFixed(2), '1.80', '单体充电上限应为 1.80V');
console.log('  ✓ 110V母线 (110.4V~144V) → 推荐 10 块 (80 节, 1.38V/1.80V)');

const rec220 = getRecommendedDcBlocks(198.0, 260.0);
assert.equal(rec220.blocks, 18, '220V系统应推荐18块');
assert.equal(rec220.cells, 144, '18块对应144节');
console.log('  ✓ 220V母线 (198V~260V)   → 推荐 18 块 (144 节)');

const rec48 = getRecommendedDcBlocks(43.2, 57.6);
assert.equal(rec48.blocks, 4, '48V系统应推荐4块');
assert.equal(rec48.cells, 32, '4块对应32节');
console.log('  ✓ 48V母线 (43.2V~57.6V)  → 推荐 4 块 (32 节)');

// 2. 测试 S2T 典型 IEEE 485 工况计算
console.log('\n2. 测试 S2T 附件典型工况 (8XNFG90 · 10块 · 3组并联 · 480min):');
const inputsS2t = {
    batteryModelId: '8XNFG90',
    cellsPerString: 80,
    blocksPerGroup: 10,
    numberOfStrings: 3,
    dcVoltMin: 110.4,
    dcVoltMax: 144.0,
    dcSystemVoltage: 110,
    temperature: 32,
    agingFactor: 1,
    designMargin: 1
};

const res = calculateDc(inputsS2t);

// 校验工况累计电量
assert.ok(Math.abs(res.rawRequiredAh - 235.09) < 0.2, `累计电量应为 235.1Ah，实际为 ${res.rawRequiredAh}`);
console.log(`  ✓ 累计负荷电量: ${res.rawRequiredAh.toFixed(2)} Ah (预期 ≈ 235.09 Ah)`);

// 校验规格书恒流放电数据
assert.equal(res.matchedEpvKey, '1.40', '查表 EPV 档位应为 1.40V');
assert.equal(res.matchedTime, 480, '查表时长应为 480min');
assert.equal(res.cellDischargeA, 11.2, '8XNFG90在1.40V 480min规格书放电电流应为 11.2 A/cell');
console.log(`  ✓ 官方规格书查表放电电流: ${res.cellDischargeA} A/cell @ EPV ${res.matchedEpvKey}V, ${res.matchedTime}min`);

// 校验系统放电能力与满足率
assert.ok(Math.abs(res.totalAvailDischargeA - 33.6) < 0.01, '3组并联可用电流应为 33.6 A');
assert.ok(res.satisfactionRatio >= 1.0, `满足率应 >= 100%，实际为 ${(res.satisfactionRatio * 100).toFixed(1)}%`);
console.log(`  ✓ 系统可用放电能力: ${res.totalAvailDischargeA} A (持续负荷需求 29.21A, 满足率 ${(res.currentSatRatio * 100).toFixed(1)}%)`);

// 校验 10C 脉冲倍率与冲击安全
assert.ok(res.pulseSafe, '峰值冲击必须安全合格');
assert.equal(res.peakCurrentPerString.toFixed(2), '44.76', '每组承担峰值冲击应为 44.76 A');
assert.equal(res.peakCrate.toFixed(2), '0.50', '峰值放电倍率应为 0.50 C');
assert.equal(res.maxAllowedPulseA, 900, '8XNFG90 单体极限放电电流应为 900 A (10C)');
console.log(`  ✓ 峰值冲击校核: 单组峰值 ${res.peakCurrentPerString.toFixed(2)} A (${res.peakCrate.toFixed(2)} C) 远低于极限 900 A (裕度 ${res.pulseMarginRatio.toFixed(1)}x)`);

// 校验锌镍系统物理拓扑与能量 (已彻底移除铅酸对比)
assert.equal(res.totalQuantity, 30, '总数量应为 30 块');
assert.equal(res.totalWeight, 519, '总重量应为 30 * 17.3 = 519 kg');
assert.equal(res.totalEnergyKWh.toFixed(1), '35.6', '标称系统能量应为 13.2V × 90Ah × 30块 = 35.6 kWh（与交流模式同口径）');
console.log(`  ✓ 锌镍系统拓扑参数: 总数量 ${res.totalQuantity} 块 · 系统总净重 ${res.totalWeight} kg · 系统标称能量 ${res.totalEnergyKWh.toFixed(1)} kWh`);

// 校验直流侧与交流侧的充电/浮充口径已统一到规格书温补电压
assert.ok(Math.abs(res.tcvCell - (1.9 - 0.002 * (32 - 25))) < 1e-9, '均充应按温补 TCV/cell 计算');
assert.equal(res.configEqualizeVoltage.toFixed(2), (res.cells * res.tcvCell).toFixed(2), '均充电压 = TCV × 节数');
assert.equal(res.configFloatVoltage.toFixed(2), (res.cells * (res.tcvCell - 0.05)).toFixed(2), '浮充电压 = (TCV − 0.05) × 节数');
assert.equal(res.chargeWithinBus, false, '80 节按 1.886V/cell 需 150.9V，超过 144V 母线上限，应识别为超限');
console.log(`  ✓ 充放电压口径统一: 均充 ${res.configEqualizeVoltage.toFixed(1)}V / 浮充 ${res.configFloatVoltage.toFixed(1)}V @32℃ (母线上限 ${res.vMax}V → ${res.chargeWithinBus ? '在窗口内' : '超限告警'})`);

// 校验分段法（恒流口径）已接入
assert.ok(res.dcSection && res.dcSection.section >= 1, '阶梯工况应走 IEEE 485 分段法');
assert.ok(res.recommendedStrings >= 1 && res.recommendedStrings <= res.strings, '分段法给出的最少组数应 ≤ 实配组数');
console.log(`  ✓ IEEE 485 分段法: 控制段 Section ${res.dcSection.section}（累计 ${res.dcSection.sectionMinutes}min）→ 需 ${res.requiredStrings.toFixed(2)} 组，实配 ${res.strings} 组`);

// 备电时间必须来自反查表，不是 时长 × 满足率
assert.notEqual(res.estimatedRunTimeMin, res.totalDurationMin * res.satisfactionRatio, '备电时间不应再线性外推');
console.log(`  ✓ 备电时间反查恒流表: ${res.estimatedRunTimeMin.toFixed(1)} min`);

console.log('════════════════════════════════════════════════════════════════════════');
console.log('交流模式智能推荐器与阶梯工况测试 (AC Recommender & Duty Cycle)');
console.log('════════════════════════════════════════════════════════════════════════');

// 3. 测试交流智能推荐器 (功率模式与容量模式)
console.log('3. 测试交流智能推荐算法:');
const acInputPower = {
    systemVoltage: 480,
    batteryModelId: '8XNFG90',
    backupTimeMin: 15,
    upsRatingKva: 200,
    powerFactor: 0.9,
    inverterEfficiency: 0.95,
    agingFactor: 1,
    designMargin: 1
};
const acRecPow = getRecommendedAcConfig(acInputPower, 'power');
assert.equal(acRecPow.voltageWindowOk, true, '480V ±20% 窗口应可行');
assert.equal(acRecPow.blocks, 36, '480V系统块数应推荐36块 (288节)');
assert.equal(acRecPow.cells, 288, '36块对应288节');
assert.equal(acRecPow.epv, 1.35, '截止电压应推荐1.35V');
assert.equal(acRecPow.strings, 2, '200kVA 15min应推荐2组并联');
assert.ok(acRecPow.satisfactionRatio >= 1.0, '推荐配置满足率应达到或超过100%');
console.log(`  ✓ 交流功率模式推荐: ${acRecPow.blocks} 块/组 (${acRecPow.cells} 节) · ${acRecPow.strings} 组并联 · EPV ${acRecPow.epv}V (满足率 ${(acRecPow.satisfactionRatio * 100).toFixed(1)}%)`);

const acInputCap = {
    systemVoltage: 480,
    batteryModelId: '8XNFG90',
    backupTimeMin: 60,
    upsRatingKva: 200,
    powerFactor: 0.9,
    inverterEfficiency: 0.95,
    agingFactor: 1,
    designMargin: 1
};
const acRecCap = getRecommendedAcConfig(acInputCap, 'capacity');
assert.equal(acRecCap.blocks, 36, '480V系统容量模式推荐36块');
assert.equal(acRecCap.strings, 5, '200kVA 60min容量模式推荐5组并联');
assert.ok(acRecCap.satisfactionRatio >= 1.0, '容量模式推荐满足率应 >= 100%');
console.log(`  ✓ 交流容量模式推荐: ${acRecCap.blocks} 块/组 (${acRecCap.cells} 节) · ${acRecCap.strings} 组并联 · EPV ${acRecCap.epv}V (满足率 ${(acRecCap.satisfactionRatio * 100).toFixed(1)}%)`);

// 电压窗口不兼容时必须直接报错，而不是给出一个装得下的块数
const acRecBad = getRecommendedAcConfig({
    ...acInputPower, systemVoltage: 240, epv: 1.3,
    upsVoltageLower: 199, upsVoltageUpper: 259.2, temperature: 32
}, 'power');
assert.equal(acRecBad.voltageWindowOk, false, 'AEG 60kVA 的 199~259.2V 窗口对锌镍不兼容，应识别出来');
console.log(`  ✓ 电压窗口不兼容识别: ${acRecBad.voltageWindowNote}`);

// 4. 测试交流阶梯负荷工况预设载入与核算
console.log('\n4. 测试交流阶梯工况与典型项目预设:');
loadAcDutyPreset(1); // 附件项目1（kVA 口径）: 161.0kVA/60m + 13.9kVA/480m
const state1 = getAcState();
assert.equal(state1.acLoadMode, 'duty', '工况模式应切换为 duty');
assert.equal(state1.acDutyCycleList.length, 2, '项目1应有两个阶段');
const totalTimeP1 = state1.acDutyCycleList.reduce((acc, c) => acc + c.durationMin, 0);
assert.equal(totalTimeP1, 540, '项目1总时长应为 540 min (9h)');
console.log(`  ✓ 载入项目1阶梯工况: 阶段1 161.0kVA/60m + 阶段2 13.9kVA/480m · 总时长 ${totalTimeP1} min (9.0h)`);

loadAcDutyPreset(2); // 附件项目2（kVA 口径）: 42.7 + 7.4 + 0.36 kVA
const state2 = getAcState();
assert.equal(state2.acDutyCycleList.length, 3, '项目2应有三个阶段');
const totalTimeP2 = state2.acDutyCycleList.reduce((acc, c) => acc + c.durationMin, 0);
assert.equal(totalTimeP2, 240, '项目2总时长应为 240 min (4h)');
console.log(`  ✓ 载入项目2阶梯工况: 42.7kVA/60m + 7.4kVA/60m + 0.36kVA/120m · 总时长 ${totalTimeP2} min (4.0h)`);

// 5. 推荐器无解时必须显式报出（旧版静默返回 10 块/80 节的错误答案）
console.log('\n5. 直流推荐器无解识别:');
const recBad = getRecommendedDcBlocks(110.4, 112.0);   // 充电上限 112V 压死 → 无可行块数
assert.equal(recBad.ok, false, '110.4~112V 窗口无可行块数，必须 ok:false');
assert.ok(recBad.note && recBad.note.length > 10, '无解时必须给出原因说明');
assert.equal(getRecommendedDcBlocks(110.4, 144.0).ok, true, '正常窗口应 ok:true');
console.log(`  ✓ 无解窗口正确识别：${recBad.note.slice(0, 38)}…`);

// 6. 恒定负荷 ↔ 阶梯工况 双向切换（旧版按钮 ID 不匹配导致切不回去）
console.log('\n6. 直流负载模式双向切换:');
setDcLoadMode('constant');
assert.equal(getDcState().dcLoadMode, 'constant', '应切换到恒定负荷');
setDcLoadMode('duty');
assert.equal(getDcState().dcLoadMode, 'duty', '应能切回阶梯工况');
setDcLoadMode('constant'); // 保持 constant 供下一项测试
console.log('  ✓ duty → constant → duty 双向切换正常');

// 7. 恒定负荷：kW 必须按放电下限 Vmin 折算电流（放电末期最严），且参数经 inputs 传入
console.log('\n7. 直流恒定负荷（kW → A 按 Vmin 折算）:');
const resConst = calculateDc({
    batteryModelId: '8XNFG90', cellsPerString: 80, blocksPerGroup: 10, numberOfStrings: 3,
    dcVoltMin: 110.4, dcVoltMax: 144.0, dcSystemVoltage: 110, temperature: 25,
    agingFactor: 1, designMargin: 1,
    dcConstLoadValue: 10, dcConstLoadUnit: 'kW', dcConstTimeMin: 60
});
assert.ok(Math.abs(resConst.continuousCurrentA - 10000 / 110.4) < 1e-6,
    `10kW 应按 Vmin=110.4 折算为 ${(10000 / 110.4).toFixed(2)}A，实际 ${resConst.continuousCurrentA.toFixed(2)}A`);
assert.ok(Math.abs(resConst.rawRequiredAh - 10000 / 110.4) < 1e-6, '60min 的 Ah 需求应等于电流值');
assert.equal(resConst.totalDurationMin, 60, '持续时长应来自 dcConstTimeMin');
console.log(`  ✓ 10kW × 60min → ${resConst.continuousCurrentA.toFixed(2)}A（按放电下限 110.4V 折算，与电压窗口口径一致）`);
setDcLoadMode('duty');   // 复原默认状态

console.log('\n────────────────────────────────────────────────────────────────────────');
console.log('全部测试用例验证通过！100% 符合要求。');
