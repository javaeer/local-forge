// LocalForge 功能门（Feature Gate）—— 开源版默认实现。
//
// 作用：为「开源免费版 / 私有 Pro 版」提供一个统一的接入点，让业务代码通过
// can(feature) / isPro() 查询授权状态，而不必关心当前是哪一版。
//
// 开源版契约（本文件）：所有功能开放、isPro() 恒为 false。零网络、零加密、
// 零支付 SDK、零 License 逻辑 —— 保持中性，可被私有版整体替换。
//
// 私有 Pro 版契约：替换本文件（保持同样的导出签名）即可接入自己的授权校验，
// 业务代码无需改动。私有版的授权实现、Dodo 端点、密钥等一律不进入开源仓库。
//
// 用法（业务代码）：
//   import { can, isPro } from '../lib/pro-gate.js'
//   if (!can('recipe-pipeline')) { /* 显示升级引导 */ }

export const PRO_FEATURES = Object.freeze([
  'recipe-pipeline',   // P1 配方流水线
  'custom-presets',    // P2 自定义预设库
  'stream-large',      // P3 大规模流式处理
])

// 私有版覆盖点：替换为读取本地授权状态的实现。
export function isPro() {
  return false
}

// 私有版覆盖点：根据授权状态决定某功能是否可用。
// 开源版对所有功能返回 true（PRO_FEATURES 里的功能在开源版尚未挂载）。
export function can(_feature) {
  return true
}
