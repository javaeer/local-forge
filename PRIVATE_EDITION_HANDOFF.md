# 私有化接缝说明（Private Edition Handoff）

> 本文只描述**开源版预留的扩展点**，供私有 Pro 版接入时参考。
> 私有版的授权实现、支付平台（Dodo）、密钥、商业代码一律**不进入本公开仓库**。

## 1. 为什么要留接缝

开源版（`javaeer/local-forge`，MIT）是获客入口；Pro 是独立私有仓库的闭源商业版。
两者共享 95% 的代码。接缝的作用是让私有版**只替换少数几个文件**就能接入授权，
而不必 fork 后大改、也不必把商业逻辑混进开源代码。

## 2. 三个扩展点

### 2.1 功能门 `src/lib/pro-gate.js`（主替换点）

开源版默认实现：

```js
export const PRO_FEATURES = ['recipe-pipeline', 'custom-presets', 'stream-large']
export function isPro() { return false }
export function can(_feature) { return true }
```

私有版**整体替换本文件**（保持相同导出签名）：

- `isPro()` → 读取本地授权状态（如校验后的 localStorage 标志）
- `can(feature)` → 按授权状态与功能白名单返回 true/false

业务代码统一用 `import { can, isPro } from '../lib/pro-gate.js'` 查询，**不改调用点**。
私有版的 License 校验、Dodo 端点、密钥等放在私有仓库自己的 `src/pro/` 下。

### 2.2 工具状态 `status:'pro'`（注册点）

`src/lib/tool-registry.js` 的 14 字段结构中，`status` 支持三值：

| 值 | 含义 |
|---|---|
| `stable` | 开源稳定工具 |
| `beta` | 开源实验工具 |
| `pro` | 私有 Pro 工具（**开源版不注册任何 pro 工具**） |

私有版按同样的 14 字段结构注册 Pro 工具并标 `status:'pro'`，用以下 API 识别：

- `isProTool(t)` — 判断单条是否为 pro
- `proTools()` / `freeTools()` — 分组

> 注意：护栏 `check-consistency.mjs` 断言 J 要求每条路由 14 字段齐全、且 registry/nav/router/首页卡片五源一致。
> 私有版注册 Pro 工具时需**同步补 nav/router/i18n/首页卡片**，否则护栏会报死链/游离。

### 2.3 一致性护栏（回归守护）

`scripts/check-consistency.mjs` 是零依赖静态扫描，本地与 CI 都跑。私有版改动后务必保持
`pnpm check:consistency` 全绿。开源版当前 13/13（含发布完整性、完整 chrome 优先、复制降级）。

## 3. 私有版建立流程（建议）

1. 从本仓库某个稳定 tag 创建私有仓库（如 `local-forge-pro`），保留完整 git 历史。
2. 在私有仓库内替换 `src/lib/pro-gate.js`，新增 `src/pro/` 授权模块与 Pro 视图。
3. 注册 Pro 工具（`status:'pro'`），补齐五源数据，保持护栏全绿。
4. 开源版有更新时，从本仓库 cherry-pick / merge 对应提交到私有仓库，冲突集中在上述扩展点。
5. 私有版自行处理发布、收款、售后，与本仓库的 CI/Release 流程解耦。

## 4. 红线

- 不在开源仓库提交任何 License 密钥、Dodo API 地址、支付回调、混淆配置。
- 不修改开源版 `pro-gate.js` 的默认行为（`isPro()` 必须恒 false、功能门全开）。
- 不把 Pro 视图、配方内核、授权 UI 放进开源仓库的 `src/` 或路由表。
