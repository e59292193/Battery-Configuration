/**
 * 工程正确性测试（黄金用例）
 * 运行：npm test
 *
 * 旧版本只对比 legacy/calc_w_v19.html 与 public/index.html 是否「输出一致」，
 * 这只能锁住行为、锁不住正确性 —— 旧版的老化系数方向错误、阶梯工况按峰值功率
 * 放满全程、容量法用标称电压折算 Ah 等问题都会被一致性测试固化下来。
 * 本文件改为直接校验物理口径，基准来自 HOPPECKE power-line designer (IEEE 485) 报告。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function sliceBetween(html, startMarker, endMarker, label) {
    const a = html.indexOf(startMarker);
    if (a < 0) throw new Error(`[${label}] 未找到起始标记: ${startMarker}`);
    const start = html.lastIndexOf('// ═', a);
    const b = html.indexOf(endMarker, a);
    if (b < 0) throw new Error(`[${label}] 未找到结束标记: ${endMarker}`);
    const end = html.lastIndexOf('// ═', b);
    return html.slice(start, end);
}

function loadEngine(htmlPath, label) {
    const html = readFileSync(htmlPath, 'utf8');
    const part1 = sliceBetween(html, '// DATA LAYER', '// UI HELPERS', label);
    const part2 = sliceBetween(html, '// CAPACITY ENGINE', '// CAPACITY PANEL RENDERER', label);
    const code = part1 + '\n' + part2 + '\n' +
        'return { BATTERY_MODELS, BATTERY_MODEL_MAP, matchEpvKey, matchTimePoint, lookupCapability,' +
        ' sizeDutyBySection, estimateRuntimeMin, avgCellVoltage, computeDutySummary,' +
        ' calculate, calculateCapacity };';
    return new Function(code)();
}

const E = loadEngine(path.join(ROOT, 'public', 'index.html'), 'public');
const near = (a, b, tol) => Math.abs(a - b) <= tol;

let pass = 0;
const ok = (name, extra = '') => { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`); };

console.log('═'.repeat(72));
console.log('计算引擎工程正确性测试');
console.log('═'.repeat(72));

// ────────────────────────────────────────────────────────────────
// 1. 老化系数必须放大需求（旧版写成除法，方向反了）
// ────────────────────────────────────────────────────────────────
console.log('1. 老化系数方向:');
const baseInput = {
    batteryModelId: '8XNFG90', upsRatingKva: 100, systemVoltage: 240, powerFactor: 0.9,
    inverterEfficiency: 0.95, agingFactor: 1, designMargin: 1, epv: 1.3, backupTimeMin: 60,
    cellsPerString: 144, numberOfStrings: 3, temperature: 25, voltageRangePercent: 20,
    requiredPowerMode: 'auto', blocksPerGroup: 18
};
const r1 = E.calculate(baseInput);
const r1Aged = E.calculate({ ...baseInput, agingFactor: 1.2 });
assert.ok(near(r1.autoRequiredPower, 100000 * 0.9 / 0.95, 0.01), '基准需求功率');
assert.ok(near(r1Aged.autoRequiredPower, r1.autoRequiredPower * 1.2, 0.01),
    `老化 1.2 应放大需求 20%，实际 ${(r1Aged.autoRequiredPower / r1.autoRequiredPower).toFixed(3)}x`);
ok('老化系数 1.2 → 需求功率 ×1.20', `${(r1.autoRequiredPower / 1000).toFixed(2)} kW → ${(r1Aged.autoRequiredPower / 1000).toFixed(2)} kW`);

// ────────────────────────────────────────────────────────────────
// 2. 阶梯工况：kVA → 电池侧能量口径必须自洽
// ────────────────────────────────────────────────────────────────
console.log('\n2. 工况 kVA → 电池侧能量口径:');
const AEG_60 = [   // AEG 60kVA（HOPPECKE 报告：40493.3W×60m + 7027.66W×60m + 340.85W×120m）
    { powerKva: 42.7, durationMin: 60 },
    { powerKva: 7.4, durationMin: 60 },
    { powerKva: 0.36, durationMin: 120 }
];
const opt = { powerFactor: 0.9, inverterEfficiency: 0.95, agingFactor: 1, designMargin: 1 };
const sum60 = E.computeDutySummary(AEG_60, opt);
const manualWh = AEG_60.reduce((a, s) => a + s.powerKva * 1000 * 0.9 / 0.95 * (s.durationMin / 60), 0);
assert.ok(near(sum60.batteryWh, manualWh, 0.01), '电池侧累计电量');
assert.ok(near(sum60.acLoadWh, sum60.batteryWh * 0.95, 0.01), '交流侧能量 = 电池侧 × 逆变效率');
assert.ok(near(sum60.steps[0].load, 40452.6, 1), `阶段1 电池侧功率应≈40.45kW，实际 ${sum60.steps[0].load.toFixed(1)}W`);
ok('累计电量与电池侧所需能量一致', `${(sum60.batteryWh / 1000).toFixed(2)} kWh（交流侧 ${(sum60.acLoadWh / 1000).toFixed(2)} kWh）`);

const capDuty = E.calculateCapacity({
    ...baseInput, dutySteps: sum60.steps, backupTimeMin: sum60.totalMin,
    requiredEnergyMode: 'manual', manualRequiredEnergy: sum60.batteryWh
});
assert.ok(near(capDuty.requiredWh, sum60.batteryWh, 0.01), '容量模式的需求总能量必须等于工况累计电量');
ok('容量模式「需求总能量」= 工况「累计电量」', `${(capDuty.requiredWh / 1000).toFixed(2)} kWh`);

// ────────────────────────────────────────────────────────────────
// 3. IEEE 485 分段法（对标 HOPPECKE AEG 60kVA 报告）
// ────────────────────────────────────────────────────────────────
console.log('\n3. IEEE 485 分段法 (AEG 60kVA · 4h 三段工况):');
const row13 = E.BATTERY_MODEL_MAP['8XNFG90'].dischargeTable['1.30'];
const sec = E.sizeDutyBySection(sum60.steps, row13);
// 手算：Section1 285.7 / Section2 309.0 / Section3 317.5 节 → 控制段为 Section 3
assert.equal(sec.section, 3, `控制段应为 Section 3，实际 Section ${sec.section}`);
assert.ok(near(sec.requiredUnits, 317.5, 1.5), `所需电芯当量应≈317.5，实际 ${sec.requiredUnits.toFixed(1)}`);
ok('控制段识别正确', `Section ${sec.section}（累计 ${sec.sectionMinutes} min）→ 需 ${sec.requiredUnits.toFixed(1)} 节`);

// 旧版做法（峰值功率放满全程）会算出 1081 节 ≈ 8 组，属于严重超配
const naive = sum60.steps[0].load / row13[240];
assert.ok(naive / sec.requiredUnits > 3, '旧版峰值法应显著超配');
ok('避免「峰值功率×全程时长」超配', `旧法 ${naive.toFixed(0)} 节 vs 分段法 ${sec.requiredUnits.toFixed(0)} 节`);

const dutyInput = { ...baseInput, dutySteps: sum60.steps, backupTimeMin: sum60.totalMin };
const r3 = E.calculate({ ...dutyInput, numberOfStrings: 3 });
const r2 = E.calculate({ ...dutyInput, numberOfStrings: 2 });
assert.ok(r3.satisfactionRatio >= 1, `18S3P 应满足，实际 ${(r3.satisfactionRatio * 100).toFixed(1)}%`);
assert.ok(r2.satisfactionRatio < 1, `18S2P 应不满足，实际 ${(r2.satisfactionRatio * 100).toFixed(1)}%`);
assert.equal(r3.recommendedStrings, 3, '最少并联组数应为 3');
ok('18S3P 满足 / 18S2P 不满足', `${(r3.satisfactionRatio * 100).toFixed(1)}% vs ${(r2.satisfactionRatio * 100).toFixed(1)}%`);

// 带老化 1.2 + 余量 1.1 后仍应成立（AEG 项目的正式口径）
const r3Full = E.calculate({ ...dutyInput, numberOfStrings: 3, agingFactor: 1.2, designMargin: 1.1,
    dutySteps: E.computeDutySummary(AEG_60, { ...opt, agingFactor: 1.2, designMargin: 1.1 }).steps });
assert.ok(r3Full.satisfactionRatio >= 1, `含老化与余量后应仍满足，实际 ${(r3Full.satisfactionRatio * 100).toFixed(1)}%`);
ok('含老化 1.2 × 余量 1.1 仍满足', `${(r3Full.satisfactionRatio * 100).toFixed(1)}%`);

// ────────────────────────────────────────────────────────────────
// 4. 功率法与容量法不得互相矛盾
// ────────────────────────────────────────────────────────────────
console.log('\n4. 功率法 ⇄ 容量法一致性:');
const pw = E.calculate({ ...baseInput, numberOfStrings: 3 });
const cp = E.calculateCapacity({ ...baseInput, numberOfStrings: 3 });
const ratio = pw.satisfactionRatio / cp.capSatisfactionRatio;
assert.ok(ratio > 0.9 && ratio < 1.1,
    `同一输入两种模式满足率差异应 <10%，实际 ${(pw.satisfactionRatio * 100).toFixed(1)}% vs ${(cp.capSatisfactionRatio * 100).toFixed(1)}%`);
ok('恒定负荷下两种模式结论一致', `${(pw.satisfactionRatio * 100).toFixed(1)}% vs ${(cp.capSatisfactionRatio * 100).toFixed(1)}%`);

// ────────────────────────────────────────────────────────────────
// 5. 备电时间必须反查表，不能线性外推
// ────────────────────────────────────────────────────────────────
console.log('\n5. 备电时间反查表:');
const exact = E.calculate({ ...baseInput, backupTimeMin: 60, numberOfStrings: 1,
    requiredPowerMode: 'manual', manualRequiredPower: row13[60] * 144 });
assert.ok(near(exact.estimatedRunTime, 60, 2), `满足率 100% 时应≈60min，实际 ${exact.estimatedRunTime?.toFixed(1)}`);
const half = E.calculate({ ...baseInput, backupTimeMin: 5, numberOfStrings: 1,
    requiredPowerMode: 'manual', manualRequiredPower: row13[5] * 144 / 3 });
const linear = 5 * 3; // 旧版：备电 × 满足率 = 15min
assert.ok(half.estimatedRunTime > linear,
    `短时档线性外推会低估，实际反查 ${half.estimatedRunTime?.toFixed(1)}min 应 > ${linear}min`);
ok('短时档不再线性外推', `5min 档 1/3 负荷：线性外推 ${linear}min vs 反查 ${half.estimatedRunTime.toFixed(1)}min`);

// ────────────────────────────────────────────────────────────────
// 6. 查表越界必须告警（不能静默按边缘档位取值）
// ────────────────────────────────────────────────────────────────
console.log('\n6. 查表越界告警:');
const overEpv = E.calculate({ ...baseInput, epv: 1.5 });
assert.equal(overEpv.epvWarning, 'high', 'EPV 1.5 高于最高档 1.45，应告警');
const overTime = E.calculate({ ...baseInput, backupTimeMin: 1500 });
assert.equal(overTime.timeWarning, 'long', '1500min 超过最长档 1200min，应告警');
const normal = E.calculate(baseInput);
assert.equal(normal.epvWarning, null);
assert.equal(normal.timeWarning, null);
ok('EPV / 时长越界均能识别');

// ────────────────────────────────────────────────────────────────
// 7. Ah 折算必须用实际平均放电电压
// ────────────────────────────────────────────────────────────────
console.log('\n7. Ah 折算口径:');
const avgV = E.avgCellVoltage(E.BATTERY_MODEL_MAP['8XNFG90'], '1.30', 240);
assert.ok(avgV > 1.5 && avgV < 1.75, `平均放电电压应在 1.5~1.75V/cell，实际 ${avgV}`);
assert.ok(Math.abs(avgV - 13.2 / 8) > 0.005, '不应等于标称 1.65V/cell');
const capAh = E.calculateCapacity({ ...baseInput, numberOfStrings: 3 });
const avgV60 = E.avgCellVoltage(E.BATTERY_MODEL_MAP['8XNFG90'], '1.30', 60);
assert.ok(near(capAh.avgStringVoltage, avgV60 * 144, 0.01), '容量法应使用平均放电电压折算 Ah');
ok('用恒功率表 ÷ 恒流表得到平均放电电压', `${avgV.toFixed(3)} V/cell @1.30V/240min`);

console.log('─'.repeat(72));
console.log(`结果: ${pass} 项断言组全部通过`);
