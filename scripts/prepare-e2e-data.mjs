#!/usr/bin/env node
// 为端到端测试补齐「日常 build 故意跳过」的大体积离线快照。
//
// 背景：
// - prebuild 为了首装速度，用 `--skip ecdict` 跳过 66MB 的 ECDICT 大词库；
// - 全量诗文库（classics/full 46 片 + 索引）按设计「不进 prebuild」，由用户主动下载。
// 但 core e2e 的 dictionary / classicsfull 两个用例深度依赖这两份数据：
// CI 的 e2e job 是独立 checkout，若只跑 pnpm build，这两份数据缺失 →
// 用例等待页面元素直到超时（dictionary 120s / classicsfull 300s），CI 长期红灯。
//
// 用法（在 install 之后、pnpm build 之前调用；脚本全部幂等，已有有效快照会跳过）：
//   node scripts/prepare-e2e-data.mjs
//
// CI 顺序：pnpm install → node scripts/prepare-e2e-data.mjs → pnpm build → pnpm test:e2e
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const NODE = process.execPath

function run(script, args = []) {
  return new Promise((resolve) => {
    const child = spawn(NODE, [join(ROOT, script), ...args], { cwd: ROOT, stdio: 'inherit' })
    child.on('exit', (code) => resolve(code ?? -1))
    child.on('error', () => resolve(-1))
  })
}

console.log('[e2e-data] 补齐大词库 ECDICT（dictionary 用例依赖）…')
let code = await run('scripts/fetch-dict.mjs', ['--only', 'ecdict'])
if (code) {
  console.error(`[e2e-data] ECDICT 拉取失败（exit ${code}）`)
  process.exit(code)
}

console.log('[e2e-data] 补齐全量诗文库（classicsfull 用例依赖）…')
code = await run('scripts/fetch-poems-full.mjs')
if (code) {
  console.error(`[e2e-data] 全量诗文库生成失败（exit ${code}）`)
  process.exit(code)
}

console.log('[e2e-data] 完成，可继续执行 pnpm build / pnpm test:e2e')
