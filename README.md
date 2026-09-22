# Battery-Configuration — Jayden的智能配置计算引擎

镍锌（Ni-Zn）电池后备（UPS）系统配置计算器 + DeepSeek AI 辅助配置分析。
单文件前端（零构建，双击即用）+ 可选的极轻量 Node 后端（解决 CORS / 密钥安全 / 大文件解析）。

> 模型型号数据：8XNFG90（13.2V 90Ah）/ 8XNFZ38（13.2V 38Ah），恒功率放电表内置于页面。

---

## 架构

```
┌──────────────────────────────────────────────────────────────┐
│  浏览器                                                       │
│  ┌──────────────────────┐   ┌──────────────────────────────┐ │
│  │ 计算引擎（纯前端）      │   │ AI 侧边栏                     │ │
│  │ · 功率法 / 容量法      │   │ · 多文件上传（Excel/PDF/图片） │ │
│  │ · 电压窗口校验         │   │ · SSE 流式对话 / 停止生成      │ │
│  │ · 放电表渲染           │   │ · CONFIG_JSON → 一键填入/撤销  │ │
│  │ · 6 套主题（CSS 变量）  │   │ · 设置面板（密钥/模型/参数）    │ │
│  └──────────────────────┘   └──────────────┬───────────────┘ │
└─────────────────────────────────────────────┼─────────────────┘
                                              │ 同源 /api（无 CORS）
                                   ┌──────────▼──────────┐
                                   │  Node 后端（可选）    │
                                   │  GET  /api/health    │
                                   │  GET  /api/models    │──► https://api.deepseek.com
                                   │  POST /api/chat (SSE)│    （密钥只在服务端）
                                   │  POST /api/parse     │
                                   └─────────────────────┘
```

- 前端由后端同域静态托管 → 浏览器永远不会直连 `api.deepseek.com`（官方端点无 CORS 头）。
- 密钥优先级：请求头 `X-User-Api-Key`（前端个人密钥，仅存 localStorage） > 服务端 `.env` 中的 `DEEPSEEK_API_KEY`。
- 不启动后端时，直接双击 `public/index.html` 所有计算功能照常可用，AI 区提示「未连接后端服务」。

## 功能清单

**计算器（与 v1.9 完全一致，回归测试 3/3 通过）**

- 功率验证模式：UPS 需求 → 恒功率放电表查值 → 单组/总功率 → 满足率 → 备电时间 → 放电电流
- 容量验证模式：需求 Wh → 串联电压 → 每串所需 Ah → 额定 Ah 对比 → 满足率
- EPV / 备电时间自动取最接近档位（禁止插值）、节数⇄块数双向联动、电压窗口校验仪表盘
- 已保存配置（localStorage）、一键复制、导出 HTML 表格、温度系数实时显示

**AI 辅助分析（DeepSeek）**

- 右上角入口，右侧滑出侧边栏（桌面 360–720px 拖拽调宽并记忆；<1024px 全屏抽屉 + 遮罩 + Esc）
- 侧边栏展开时左侧等比压缩降列（1280–1600px 自动 2 列 → 1 列），无遮挡、无横向滚动
- 多文件上传：多选 / 拖拽 / Ctrl+V 粘贴图片；Excel(.xlsx/.xls/.csv)、PDF、图片；单文件 ≤20MB、单次 ≤10 个；文件 chip 显示解析状态与缩略图，可单独删除
- 解析双通道：优先 `POST /api/parse`（xlsx / pdfjs-dist / sharp），失败自动回退浏览器本地解析（SheetJS / pdf.js / Canvas 压缩）；扫描版 PDF 自动转图片走视觉通道
- 每次请求自动注入：当前型号完整放电表 + 全部输入与结果 + 计算规则（页面底部可查看注入内容）
- 流式输出（SSE）逐字渲染 Markdown（表格/代码块），可随时停止
- 回复末尾 `<CONFIG_JSON>` → 「AI 推荐配置」卡片：当前值→推荐值对比（变化高亮）、单项勾选、**一键填入**（校验 → 写入 → 联动 → 重算 → 平滑滚动 + 高亮闪烁）、**撤销填入**
- 「发送当前配置」一键附加页面实时快照
- Flash / Pro 模型胶囊一键切换（记忆），模型下拉从 `GET /api/models` 动态拉取
- 设置面板：服务端密钥状态、个人密钥（保存即掩码 `sk-****xxxx`）、测试连接、temperature / max_tokens / 流式 / 超时 / 上下文轮数
- 错误分类中文提示：401 密钥无效 / 402 余额不足 / 429 限流 / 超时 / CORS 被拦截 / 上游 5xx

**主题系统**

- 6 套主题：深夜 Dark、浅色 Light、薄荷 Mint、天空 Sky、暖沙 Sand、樱花粉 Sakura
- 全部颜色由语义化 CSS 变量驱动（`--c-panel` / `--c-text` / `--c-accent` …），通过 Tailwind CDN arbitrary color 映射，彻底移除旧版属性选择器 hack
- 正文对比度 ≥ 4.5:1、次要文字 ≥ 3:1；覆盖输入框、select option、表格斑马纹、tooltip、徽章、禁用/hover/focus 态、AI 侧边栏与设置面板

## 计算逻辑（AI 与页面共同遵守）

| 公式 | 定义 |
|---|---|
| 温度补偿充电电压 | 单体口径：`TCV/cell = 1.9 − 0.002 × (T − 25)`；块级口径（8串/块）：`TCV/块 = 15.2 − 0.016 × (T − 25)`（两者等价，块级 ÷ 8 = 单体） |
| 放电下限 | `batteryDischargeLower = EPV × cellsPerString` |
| 充电上限 | `batteryChargeUpper = TCV/cell × cellsPerString`（按电芯串数计算，4S2P 等型号自动正确） |
| 浮充电压 | `configFloatVoltage = (TCV/cell − 0.05) × cellsPerString`，即块级 `TCV/块 − 0.4V` |
| UPS 窗口 | `±voltageRangePercent%`；要求 放电下限 ≥ 窗口下限 且 充电上限 ≤ 窗口上限 |
| 自动需求功率 | `upsRatingKva × 1000 × PF ÷ 逆变效率 × 老化系数 × 设计余量`（老化系数**乘**，与 IEEE 485 一致） |
| 工况表（多段负载） | 每段输入 **kVA**，折算电池侧功率 `kVA × 1000 × PF ÷ 逆变效率 × 老化系数 × 设计余量`；表内「累计电量」与「需求总能量」同口径 |
| 分段选型（IEEE 485） | `sizeDutyBySection(steps,row)`：对第 1…N 段逐段累计，取**各断面所需电芯当量的最大值**作为控制断面；禁止用「峰值功率 × 全程时长」 |
| 功率法 | 查表（EPV、时间点就近取档，禁止插值）→ `满足率 = 总提供功率 ÷ 总需求功率`；备电时间由恒功率表**反查插值** `estimateRuntimeMin()`，越界以 `<` / `>` 标注 |
| 容量法 | 以恒功率表做**能量校核**；Ah 视图的平均单体电压取 `avgCellVoltage() = 恒功率表 ÷ 恒流表`，不再写死 13.2V |
| 查表越界 | `lookupCapability()` / `epvOutOfRange()` 返回越界标记，UI 必须给出告警（`capLookupWarning`） |
| 推荐器 | 块数同时受电压窗口约束：`maxBlocksByCharge`（充电上限）与 `minBlocksByDischarge`（放电下限）；无解时返回 `voltageWindowOk: false` |
| DC 系统 | 能量统一按 13.2V 口径；浮充/均充电压由温补 TCV（1.9 / 1.85 V/cell）推导，超出母线窗口给 `chargeWithinBus` 告警；铅酸对比基准由需求能量推导（`VRLA_REF_WH_PER_KG=35`、`VRLA_REF_WH_PER_L=85`） |
| 硬性约束 | `cellsPerString` 必须是 8 的倍数；满足率 < 100% 必须警示；切换 AC/DC 模式时电压窗口复位 |

回归测试：`npm test` 运行 11 组工程正确性黄金用例（基准来自 HOPPECKE IEEE 485 选型报告，AEG 60kVA / 210kVA 工况），覆盖老化系数方向、分段选型控制断面、kVA 折算、反查备电时间、越界告警与电压窗口约束。

## DeepSeek API 与后端配置

1. 在 [platform.deepseek.com](https://platform.deepseek.com/api_keys) 申请 API Key。
2. 配置密钥（二选一，可共存，个人密钥优先）：
   - **服务端（推荐）**：复制 `.env.example` 为 `.env`，填入 `DEEPSEEK_API_KEY=sk-...`。前端完全不接触密钥，设置面板显示「后端已连接 · 服务端密钥」。
   - **前端个人密钥**：AI 设置面板 → 修改 → 粘贴 Key → 保存。仅存本机 localStorage，请求经 `X-User-Api-Key` 头由后端代转。
3. 模型：`deepseek-flash`（快速，支持图片输入；旧别名 `deepseek-v4-flash` 兼容）与 `deepseek-v4-pro`（强推理）。下拉列表在启动时经 `GET /api/models` 动态拉取，失败回退内置默认。
4. 多模态：图片以 OpenAI 兼容 `content: [{type:"text"},{type:"image_url",image_url:{url:"data:image/jpeg;base64,..."}}]` 发送，仅 user 消息可含图，JPEG/PNG/GIF/WebP 支持（BMP 前端自动转码）。

## 三种运行方式

### 方式一：本地 Node（完整功能）

```bash
npm install
npm start          # http://localhost:3000
```

### 方式二：Docker

```bash
docker compose up -d          # 构建并启动，端口 3000
# 或
docker build -t battery-config . && docker run -p 3000:3000 -e DEEPSEEK_API_KEY=sk-xxx battery-config
```

### 方式三：仅前端（无 AI）

直接双击打开 `public/index.html`。全部计算功能可用；AI 区显示「未连接后端服务」引导。

### 附：Cloudflare Worker 代理（不想跑 Node 时）

`deploy/cloudflare-worker.js` 为单文件 Worker 实现（含 SSE 透传）。部署后在「AI 设置 → 服务地址」填 `https://<你的子域>.workers.dev/api`，并在 Worker 环境变量中配置 `DEEPSEEK_API_KEY`（可选）。Worker 不支持 `/api/parse`，前端会自动回退浏览器本地解析。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `DEEPSEEK_API_KEY` | 空 | 服务端密钥（.env，已被 .gitignore 忽略） |
| `PORT` | 3000 | 服务端口 |
| `ALLOWED_ORIGINS` | `*` | 跨域来源白名单（同源托管无需关心） |
| `RATE_LIMIT` | 30 | 每 IP 每分钟请求上限 |

## 后端接口

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | `{ ok, hasServerKey }`（只暴露布尔，不回传密钥） |
| `/api/models` | GET | 代转模型列表，5 分钟内存缓存；需密钥 |
| `/api/chat` | POST | OpenAI 兼容 chat/completions；`stream:true` 时 SSE 逐块透传，客户端中断即断上游；120s 上游超时 |
| `/api/parse` | POST | multipart 多文件解析：Excel/CSV→结构化文本（>200 行截断注明）、PDF→文本层（无文本层返回 `needsVision:true`）、图片→sharp 压缩 base64 |

安全与健壮性：密钥优先级透传、单文件 20MB / 单次 10 个 / 总计 60MB、MIME 与扩展名白名单、内存流处理不落盘、请求体 ≤50MB、每 IP 限流、统一错误中间件（`code + 中文 message`）、日志只记路径/模型/耗时/token（绝不记录密钥与文件内容）。

## CONFIG_JSON 协议

AI 回复末尾输出（前端解析为推荐配置卡）：

```json
<CONFIG_JSON>
{
  "batteryModel": "8XNFG90",
  "upsRatingKva": 200, "systemVoltage": 480, "powerFactor": 0.9,
  "inverterEfficiency": 0.95, "epv": 1.35, "cellsPerString": 288,
  "blocksPerGroup": 36, "numberOfStrings": 2, "designMargin": 1,
  "agingFactor": 1, "temperature": 20, "voltageRangePercent": 20,
  "backupTimeMin": 15, "requiredPowerMode": "auto", "manualRequiredPower": 0,
  "calcMode": "power",
  "reason": { "cellsPerString": "向下取 8 的倍数以满足电压窗口…", "…": "…" }
}
</CONFIG_JSON>
```

前端填入前的校验：数值范围（min/max/step）、型号存在性、`cellsPerString % 8 === 0`、枚举值合法；非法值整批拒绝并说明原因。填入顺序处理依赖（系统电压 → 节数 → 块数联动），随后统一联动 + 重算 + 滚动高亮，可一键撤销。

## 目录结构

```
├── public/index.html          # 前端单文件（计算器 + AI 侧边栏，零构建）
├── server/
│   ├── index.js               # Express 入口：静态托管 + API + 错误中间件
│   ├── routes/{health,models,chat,parse}.js
│   └── lib/{env,errors}.js    # .env 加载 / 限流 / CORS / 错误映射 / 日志
├── deploy/cloudflare-worker.js  # 可选 Worker 代理（SSE 透传）
├── tests/regression.mjs       # 新旧引擎回归对比（npm test）
├── legacy/calc_w_v19.html     # v1.9 原始版本存档
├── Dockerfile / docker-compose.yml
├── .env.example / .gitignore / LICENSE(MIT)
```

## 主题预览

| 主题 | 底色 | 强调色 |
|---|---|---|
| 深夜 Dark | 石板深蓝 | 天蓝 |
| 浅色 Light | 冷灰白 | 蓝 |
| 薄荷 Mint | 薄荷绿白 | 青绿 |
| 天空 Sky | 天蓝白 | 海蓝 |
| 暖沙 Sand | 暖沙米 | 陶橙 |
| 樱花粉 Sakura | 樱粉白 | 玫粉 |

右上角色卡下拉即时切换，记忆到 localStorage。

## 免责声明

本项目用于辅助镍锌电池后备系统选型计算，放电表数据与计算模型仅供参考，最终配置请以电池厂商技术手册与现场校核为准。AI 生成的建议可能存在错误，填入前请核对页面复算结果；作者不对因使用本工具产生的任何后果承担责任。
