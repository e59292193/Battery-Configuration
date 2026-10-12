import { readFileSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const htmlPath = path.join(ROOT, 'public', 'index.html');
const html = readFileSync(htmlPath, 'utf8');

console.log('═'.repeat(72));
console.log('国际化与双语导出功能专项测试 (i18n & Export Bilingual Test)');
console.log('═'.repeat(72));

// 1. 验证 DOM 结构与语言选择器存在
console.log('1. DOM 结构与语言选择组件验证:');
assert.ok(html.includes('id="langPickerWrap"'), '顶部导航栏必须包含语言选择器 id="langPickerWrap"');
assert.ok(html.includes('id="langPickerBtn"'), '顶部导航栏必须包含语言切换按钮 id="langPickerBtn"');
assert.ok(html.includes('id="langMenu"'), '顶部导航栏必须包含语言下拉菜单 id="langMenu"');
assert.ok(html.includes('data-lang-id="zh"'), '必须包含简体中文选项 data-lang-id="zh"');
assert.ok(html.includes('data-lang-id="en"'), '必须包含英文选项 data-lang-id="en"');

assert.ok(html.includes('id="exportLangLabelText"'), '导出模态框必须包含导出语言标签 id="exportLangLabelText"');
assert.ok(html.includes('name="exportLangRadio" value="zh"'), '导出模态框必须包含中文导出单选选项');
assert.ok(html.includes('name="exportLangRadio" value="en"'), '导出模态框必须包含英文导出单选选项');
assert.ok(html.includes('function initLanguageEvents()'), '必须包含语言切换事件绑定函数 initLanguageEvents');
assert.ok(html.includes('function applyLanguage(lang)'), '必须包含语言切换应用函数 applyLanguage');
assert.ok(html.includes('const I18N = {'), '必须包含中英文词条字典 I18N');
assert.ok(html.includes('initLanguageEvents();'), '初始化流程必须调用 initLanguageEvents()');
assert.ok(html.includes('applyLanguage(currentLang);'), '初始化流程必须调用 applyLanguage(currentLang)');
console.log('  ✓ 顶部语言切换器与导出模态框双语设置器 DOM 结构及逻辑函数完整');

// 2. 模拟运行计算引擎并测试 getExportDataset
console.log('\n2. 导出表格数据集双语生成校验:');

function extractCode(startMarker, endMarker) {
    const a = html.indexOf(startMarker);
    if (a < 0) throw new Error(`Marker not found: ${startMarker}`);
    const b = html.indexOf(endMarker, a);
    if (b < 0) throw new Error(`Marker not found: ${endMarker}`);
    return html.slice(a, b);
}

const dataLayer = extractCode('// DATA LAYER', '// UI HELPERS');
const uiHelpers = extractCode('// UI HELPERS', '// CURRENT CONFIG COPY SUMMARY');
const acEngine = extractCode('// AC RECOMMENDER & DUTY CYCLE ENGINE', '// DC UPS ENGINE & RENDERER');
const dcEngine = extractCode('// DC UPS ENGINE & RENDERER', '// CALCULATION STEPS RENDERER');

// 提取 export 模块
const exportCode = extractCode('// EXPORT MODAL & MULTI-FORMAT EXPORT ENGINE', '// MAIN RECALCULATE');
const copySummaryCode = extractCode('// CURRENT CONFIG COPY SUMMARY', '// EXPORT MODAL & MULTI-FORMAT EXPORT ENGINE');

// 构造测试运行沙盒
const testFn = new Function(`
    const mockEl = {
        addEventListener: () => {},
        classList: { toggle: () => {}, add: () => {}, remove: () => {} },
        value: '',
        textContent: '',
        innerHTML: ''
    };
    const document = {
        getElementById: () => mockEl,
        querySelectorAll: () => [],
        querySelector: () => null,
        addEventListener: () => {}
    };
    const window = { addEventListener: () => {} };
    let currentLang = 'zh';
    let calcMode = 'power';
    function recalculate() {}
    ${dataLayer}
    ${uiHelpers}
    ${acEngine}
    ${dcEngine}
    ${copySummaryCode}
    ${exportCode}

    function runTest() {
        const baseInput = {
            batteryModelId: '8XNFG90', upsRatingKva: 200, systemVoltage: 480, powerFactor: 0.9,
            inverterEfficiency: 0.95, agingFactor: 1.2, designMargin: 1.1, epv: 1.35, backupTimeMin: 15,
            cellsPerString: 290, numberOfStrings: 2, temperature: 20, voltageRangePercent: 20,
            requiredPowerMode: 'auto', blocksPerGroup: 37
        };
        const r = calculate(baseInput);
        lastExportInputs = baseInput;
        lastExportResult = r;
        lastExportDc = null;
        calcMode = 'power';

        // 测试 AC 模式导出：中文
        const dataZh = getExportDataset('zh');
        // 测试 AC 模式导出：英文
        const dataEn = getExportDataset('en');

        // 测试 AC 复制摘要
        const summaryZh = buildConfigSummary(baseInput, r, null, 'zh');
        const summaryEn = buildConfigSummary(baseInput, r, null, 'en');

        // 测试 DC 模式
        calcMode = 'dc';
        dcLoadMode = 'duty';
        const dcInputs = {
            ...baseInput,
            dcSystemVoltage: 110,
            dcVoltMax: 144,
            dcVoltMin: 110.4,
            cellsPerString: 80,
            blocksPerGroup: 10,
            numberOfStrings: 3,
            epv: 1.40
        };
        const dcResult = calculateDc(dcInputs);
        lastExportInputs = dcInputs;
        lastExportResult = null;
        lastExportDc = dcResult;

        const dcDataZh = getExportDataset('zh');
        const dcDataEn = getExportDataset('en');
        const dcSummaryZh = buildConfigSummary(dcInputs, null, dcResult, 'zh');
        const dcSummaryEn = buildConfigSummary(dcInputs, null, dcResult, 'en');

        return {
            dataZh, dataEn, summaryZh, summaryEn,
            dcDataZh, dcDataEn, dcSummaryZh, dcSummaryEn
        };
    }

    return runTest();
`);

const res = testFn();

// 校验 AC 中文数据集
assert.equal(res.dataZh.title, '锌镍电池系统配置方案');
assert.ok(res.dataZh.upsLabel.includes('KVA UPS'));
assert.ok(res.dataZh.rows.some(r => r.label === '电池型号'));
assert.ok(res.dataZh.rows.some(r => r.label === '配置总功率'));
assert.ok(res.dataZh.rows.some(r => r.category === '基础电气规格'));
assert.ok(res.dataZh.rows.some(r => String(r.value).includes('块')));
console.log('  ✓ 交流模式中文数据集生成正确 (标题、分类、标签与单位)');

// 校验 AC 英文数据集
assert.equal(res.dataEn.title, 'Ni-Zn Battery System Configuration Solution');
assert.ok(res.dataEn.upsLabel.includes('kVA UPS'));
assert.ok(res.dataEn.rows.some(r => r.label === 'Battery Model'));
assert.ok(res.dataEn.rows.some(r => r.label === 'Total Proposed Power'));
assert.ok(res.dataEn.rows.some(r => r.category === 'Basic Electrical Specs'));
assert.ok(res.dataEn.rows.some(r => String(r.value).includes('Blocks')));
console.log('  ✓ 交流模式英文数据集生成正确 (Title, Categories, Labels, Units)');

// 校验 DC 中文数据集
assert.equal(res.dcDataZh.title, '锌镍电池系统配置方案');
assert.ok(res.dcDataZh.upsLabel.includes('直流 UPS'));
assert.ok(res.dcDataZh.rows.some(r => r.label === '母线工作电压范围'));
assert.ok(res.dcDataZh.rows.some(r => r.label === '持续负荷 / 峰值冲击电流'));
assert.ok(res.dcDataZh.rows.some(r => r.category === '工况负荷需求'));
console.log('  ✓ 直流模式中文数据集生成正确 (母线范围、冲击电流与工况)');

// 校验 DC 英文数据集
assert.equal(res.dcDataEn.title, 'Ni-Zn Battery System Configuration Solution');
assert.ok(res.dcDataEn.upsLabel.includes('DC UPS'));
assert.ok(res.dcDataEn.rows.some(r => r.label === 'DC Bus Voltage Range'));
assert.ok(res.dcDataEn.rows.some(r => r.label === 'Continuous / Peak Pulse Current'));
assert.ok(res.dcDataEn.rows.some(r => r.category === 'Load & Duty Profile'));
assert.ok(res.dcDataEn.rows.some(r => String(r.value).includes('Strings Parallel')));
console.log('  ✓ 直流模式英文数据集生成正确 (DC Bus Range, Inrush Current, Strings)');

// 校验配置文本摘要
assert.ok(res.summaryZh.includes('【电池配置详细信息'));
assert.ok(res.summaryEn.includes('【Battery Configuration Details】'));
assert.ok(res.dcSummaryZh.includes('【直流UPS电池配置方案'));
assert.ok(res.dcSummaryEn.includes('【DC UPS Battery Configuration Solution】'));
console.log('  ✓ 一键复制详细摘要双语生成正确 (交流与直流模式)');

console.log('────────────────────────────────────────────────────────────────────────');
console.log('国际化与双语导出所有断言校验全部通过！100% 满足需求。');
