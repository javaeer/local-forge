<script setup>
// 阶段进度条（A-5）：渲染 createProgress() 的加权多阶段进度。
// 每个阶段一小段，完成的填满、进行中的按比例填充，末尾显示总百分比与当前阶段文案。
import { computed } from 'vue'
import { t } from '../lib/i18n.js'

const props = defineProps({
  progress: { type: Object, required: true }, // createProgress() 返回值
  showLabel: { type: Boolean, default: true },
})

const segs = computed(() => {
  const p = props.progress
  const tw = p.phases.reduce((s, x) => s + x.weight, 0) || 1
  return p.phases.map((ph) => {
    const ratio = p.ratios.value[ph.id] || 0
    return {
      id: ph.id,
      label: typeof ph.label === 'function' ? ph.label() : ph.label,
      weight: ph.weight,
      flex: ph.weight / tw,
      fill: Math.round(ratio * 100),
      done: ratio >= 1,
      active: p.activeId.value === ph.id,
    }
  })
})
const pct = computed(() => props.progress.overall.value)
const label = computed(() => props.progress.activeLabel.value || (pct.value >= 100 ? t('progress.done') : ''))
</script>

<template>
  <div class="phase-progress">
    <div class="segs">
      <div v-for="s in segs" :key="s.id" class="seg" :style="{ flexGrow: s.flex }" :title="s.label">
        <span class="fill" :class="{ done: s.done }" :style="{ width: s.fill + '%' }"></span>
        <span v-if="showLabel && s.flex >= 0.25" class="seg-label">{{ s.label }}</span>
      </div>
    </div>
    <div class="meta">
      <span class="lbl">{{ label }}</span>
      <span class="num">{{ pct }}%</span>
    </div>
  </div>
</template>

<style scoped>
.phase-progress { display: flex; flex-direction: column; gap: 7px; }
.segs { display: flex; gap: 4px; height: 8px; }
.seg {
  position: relative; border-radius: 999px; overflow: hidden;
  background: rgba(120,150,200,.18); min-width: 24px;
}
.fill {
  position: absolute; inset: 0 auto 0 0; height: 100%;
  background: var(--grad, linear-gradient(90deg,#38bdf8,#a78bfa)); transition: width .25s;
}
.fill.done { background: var(--accent-2, #34d399); }
.seg-label {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font-size: 10px; color: #0b1220; font-weight: 700; letter-spacing: .3px; pointer-events: none;
}
.meta { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--muted, #93a2bd); }
.num { font-variant-numeric: tabular-nums; color: var(--accent, #38bdf8); font-weight: 600; }
</style>
