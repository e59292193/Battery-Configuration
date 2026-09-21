/**
 * 回归测试：对比旧版 calc_w_v19.html 与新版 public/index.html 的计算引擎输出
 * 运行：npm test   （等价于 node tests/regression.mjs）
 *
 * 原理：两个 HTML 的引擎代码位于相同的分区注释之间
 *   （DATA LAYER → UI HELPERS，CAPACITY ENGINE → CAPACITY PANEL RENDERER），
 *   本脚本直接截取真实源码在 Node 中求值后逐字段比对，保证「所见即所测」。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 从 HTML 源码中截取两个分区标记之间的引擎代码（含分区装饰行） */
function sliceBetween(html, startMarker, endMarker, label) {
    const a = html.indexOf(startMarker);
    if (a < 0) throw new Error(`[${label}] 未找到起始标记: ${startMarker}`);
    const start = html.lastIndexOf('// ═', a);
    const b = html.indexOf(endMarker, a);
    if (b < 0) throw new Error(`[${label}] 未找到结束标记: ${endMarker}`);
    const end = html.lastIndexOf('// ═', b);
    return html.slice(start, end);
}

/** 加载某个 HTML 文件中的纯计算引擎 */
function loadEngine(htmlPath, label) {
    const html = readFileSync(htmlPath, 'utf8');
    const part1 = sliceBetween(html, '// DATA LAYER', '// UI HELPERS', label);          // BATTERY_MODELS + calculate
    const part2 = sliceBetween(html, '// CAPACITY ENGINE', '// CAPACITY PANEL RENDERER', label); // calculateCapacity
    const code = part1 + '\n' + part2 + '\n' +
        'return { BATTERY_MODELS, BATTERY_MODEL_MAP, matchEpvKey, matchTimePoint, calculate, calculateCapacity };';
    return new Function(code)();
}

const oldEngine = loadEngine(path.join(ROOT, 'legacy', 'calc_w_v19.html'), 'legacy');
const newEngine = loadEngine(path.join(ROOT, 'public', 'index.html'), 'public');

/** 回归用例（覆盖两种型号 / 自动与手动功率 / 长短备电 / 不同温度与电压窗口） */
const CASES = [
    {
        name: 'A 默认参数（8XNFG90 · 200kVA · 15min · 自动）',
        inputs: {
            batteryModelId: '8XNFG90', upsRatingKva: 200, systemVoltage: 480, powerFactor: 0.9,
            inverterEfficiency: 0.95, agingFactor: 1, designMargin: 1, epv: 1.35, backupTimeMin: 15,
            cellsPerString: 290, numberOfStrings: 2, temperature: 20, voltageRangePercent: 20,
            upsVoltageLower: 384, upsVoltageUpper: 576, requiredPowerMode: 'auto',
            manualRequiredPower: NaN, blocksPerGroup: 37,
        },
    },
    {
        name: 'B 小型号长时（8XNFZ38 · 80kVA · 120min · 自动 · 35℃）',
        inputs: {
            batteryModelId: '8XNFZ38', upsRatingKva: 80, systemVoltage: 240, powerFactor: 0.8,
            inverterEfficiency: 0.92, agingFactor: 0.95, designMargin: 1.1, epv: 1.3, backupTimeMin: 120,
            cellsPerString: 145, numberOfStrings: 3, temperature: 35, voltageRangePercent: 15,
            upsVoltageLower: 204, upsVoltageUpper: 276, requiredPowerMode: 'auto',
            manualRequiredPower: NaN, blocksPerGroup: 19,
        },
    },
    {
        name: 'C 手动功率（8XNFG90 · 50000W · 30min · 0℃）',
        inputs: {
            batteryModelId: '8XNFG90', upsRatingKva: 120, systemVoltage: 240, powerFactor: 0.95,
            inverterEfficiency: 0.9, agingFactor: 1, designMargin: 1.05, epv: 1.2, backupTimeMin: 30,
            cellsPerString: 144, numberOfStrings: 4, temperature: 0, voltageRangePercent: 10,
            upsVoltageLower: 216, upsVoltageUpper: 264, requiredPowerMode: 'manual',
            manualRequiredPower: 50000, blocksPerGroup: 18,
        },
    },
    {
        name: 'D 手动能量模式（8XNFG90 · 150000Wh · 10h/600min）',
        inputs: {
            batteryModelId: '8XNFG90', upsRatingKva: 200, systemVoltage: 480, powerFactor: 0.9,
            inverterEfficiency: 0.95, agingFactor: 1, designMargin: 1, epv: 1.35, backupTimeMin: 600,
            cellsPerString: 288, numberOfStrings: 2, temperature: 25, voltageRangePercent: 20,
            upsVoltageLower: 384, upsVoltageUpper: 576, requiredPowerMode: 'auto',
            requiredEnergyMode: 'manual', manualRequiredEnergy: 150000, blocksPerGroup: 36,
        },
    },
    {
        name: 'E 8XNFZ38 新增 15h/900min 档位（EPV 1.25 · 自动）',
        inputs: {
            batteryModelId: '8XNFZ38', upsRatingKva: 50, systemVoltage: 240, powerFactor: 0.9,
            inverterEfficiency: 0.93, agingFactor: 1, designMargin: 1, epv: 1.25, backupTimeMin: 900,
            cellsPerString: 144, numberOfStrings: 2, temperature: 25, voltageRangePercent: 15,
            upsVoltageLower: 204, upsVoltageUpper: 276, requiredPowerMode: 'auto',
            blocksPerGroup: 18,
        },
    },
    {
        name: 'F 8XNFZ38 新增 20h/1200min 档位 + 手动能量模式（EPV 1.40）',
        inputs: {
            batteryModelId: '8XNFZ38', upsRatingKva: 30, systemVoltage: 240, powerFactor: 0.85,
            inverterEfficiency: 0.9, agingFactor: 1, designMargin: 1, epv: 1.40, backupTimeMin: 1200,
            cellsPerString: 144, numberOfStrings: 3, temperature: 20, voltageRangePercent: 20,
            upsVoltageLower: 192, upsVoltageUpper: 288, requiredPowerMode: 'auto',
            requiredEnergyMode: 'manual', manualRequiredEnergy: 80000, blocksPerGroup: 18,
        },
    },
];

/** 深度取平：把结果对象拍平为 key → value（嵌套一层） */
function flatten(obj, prefix = '') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const key = prefix ? `${prefix}.${k}` : k;
        if (v !== null && typeof v === 'object') Object.assign(out, flatten(v, key));
        else out[key] = v;
    }
    return out;
}

let pass = 0, fail = 0;
const rows = [];

for (const c of CASES) {
    const ro = flatten(oldEngine.calculate(c.inputs));
    const rn = flatten(newEngine.calculate(c.inputs));
    const co = flatten(oldEngine.calculateCapacity(c.inputs));
    const cn = flatten(newEngine.calculateCapacity(c.inputs));

    const allKeys = new Set([...Object.keys(ro), ...Object.keys(rn), ...Object.keys(co), ...Object.keys(cn)]);
    const diffs = [];
    for (const k of allKeys) {
        const a = ro[k] ?? co[k];
        const b = rn[k] ?? cn[k];
        if (String(a) !== String(b)) diffs.push(`${k}: old=${a} new=${b}`);
    }
    if (diffs.length === 0) { pass++; rows.push(`✓ ${c.name} — ${allKeys.size} 项结果完全一致`); }
    else { fail++; rows.push(`✗ ${c.name} — 存在差异:\n    ` + diffs.join('\n    ')); }
}

console.log('═'.repeat(72));
console.log('回归测试：legacy/calc_w_v19.html ⇆ public/index.html 计算引擎对比');
console.log('═'.repeat(72));
rows.forEach(r => console.log(r));
console.log('─'.repeat(72));
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
