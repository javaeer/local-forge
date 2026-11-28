// 统一阶段进度（A-5）。
//
// 问题：此前各工具只有"一根进度条"，用户无法分辨当前卡在"加载内核"、"读取文件"
// 还是"实际转码"——而三者耗时量级完全不同（内核首次加载可达数秒）。
//
// 本模块提供一个极简的响应式阶段进度模型：
//   phases: [{ id, label, weight }]     —— 预声明的阶段序列（weight 用于加权总进度）
//   set(id, ratio)                      —— 设置某阶段完成比（0..1），自动推算总进度
//   activeId                            —— 当前进行中的阶段（用于文案）
//
// 用法（引擎侧只管报告，视图侧只管渲染）：
//   const p = createProgress([{id:'core',label:'加载内核',weight:3},{id:'run',label:'转码',weight:7}])
//   p.set('core', 0.5); p.set('core', 1); p.set('run', 0.3)
import { ref, computed } from 'vue'

export function createProgress(phases) {
  const list = phases.map((x) => ({ weight: 1, ...x }))
  const ratios = ref(Object.fromEntries(list.map((p) => [p.id, 0])))
  const activeId = ref(null)

  const totalWeight = list.reduce((s, p) => s + p.weight, 0)

  const overall = computed(() => {
    let acc = 0
    for (const p of list) acc += (ratios.value[p.id] || 0) * p.weight
    return totalWeight ? Math.round((acc / totalWeight) * 100) : 0
  })

  const activeLabel = computed(() => {
    const p = list.find((x) => x.id === activeId.value)
    if (!p) return ''
    return typeof p.label === 'function' ? p.label() : p.label
  })

  function set(id, ratio) {
    const r = Math.max(0, Math.min(1, Number(ratio) || 0))
    ratios.value = { ...ratios.value, [id]: r }
    // 取"最靠后且未完成"的阶段为 active
    const idx = list.findIndex((p) => (ratios.value[p.id] || 0) < 1)
    activeId.value = idx >= 0 ? list[idx].id : null
  }
  function reset() {
    ratios.value = Object.fromEntries(list.map((p) => [p.id, 0]))
    activeId.value = list[0] ? list[0].id : null
  }
  function finish() {
    ratios.value = Object.fromEntries(list.map((p) => [p.id, 1]))
    activeId.value = null
  }

  reset()
  return { phases: list, ratios, overall, activeId, activeLabel, set, reset, finish }
}
