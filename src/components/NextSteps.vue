<script setup>
// 跨工具工作流：在结果区渲染"下一步"，把结果文件送入相关工具。
// 用法一（同步）：<NextSteps from="/image-convert" :files="[{ blob, name }]" />
// 用法二（惰性/异步）：<NextSteps from="/zip-extract" :get-files="collectEntries" />
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { flowsFrom, stashFiles, wfLabel } from '../lib/workflow.js'
import { locale } from '../lib/i18n.js'

const props = defineProps({
  from: { type: String, required: true },
  files: { type: Array, default: () => [] },      // [{ blob, name }]
  getFiles: { type: Function, default: null },    // () => Promise<[{blob,name}]>
  title: { type: String, default: '' },
})

const router = useRouter()
const busy = ref(false)
const flows = computed(() => flowsFrom(props.from))
const labelOf = (f) => wfLabel(f.labelKey, locale.value)

function toFile(f) {
  const blob = f && f.blob
  if (!blob) return null
  if (typeof File !== 'undefined' && blob instanceof File) return blob
  return new File([blob], (f && f.name) || 'file', { type: blob.type || 'application/octet-stream' })
}

async function go(flow) {
  if (busy.value) return
  let list = props.files
  if (props.getFiles) {
    busy.value = true
    try { list = await props.getFiles() } catch { list = [] } finally { busy.value = false }
  }
  const items = (list || []).map(toFile).filter(Boolean)
  if (items.length) stashFiles(items, props.from)
  router.push(flow.to)
}
</script>

<template>
  <div v-if="flows.length" class="next-steps">
    <span class="ns-label"><i class="bi bi-diagram-3"></i> {{ title || (locale === 'en' ? 'Next step' : '下一步') }}</span>
    <div class="ns-btns">
      <button v-for="f in flows" :key="f.to" class="ns-btn" type="button" :disabled="busy" @click="go(f)">
        {{ labelOf(f) }} <i class="bi bi-arrow-right-short"></i>
      </button>
    </div>
  </div>
</template>

<style scoped>
.next-steps {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
  margin-top: 12px; padding: 10px 12px; border-radius: 12px;
  border: 1px dashed var(--line-strong, rgba(120,150,200,.32));
  background: var(--panel-2, rgba(28,37,60,.4));
}
.ns-label {
  display: inline-flex; align-items: center; gap: 6px; flex: none;
  color: var(--muted, #93a2bd); font-size: 12.5px;
}
.ns-label i { color: var(--accent, #38bdf8); }
.ns-btns { display: flex; flex-wrap: wrap; gap: 7px; }
.ns-btn {
  display: inline-flex; align-items: center; gap: 3px;
  padding: 6px 12px; border-radius: 999px; cursor: pointer; font-size: 12.5px;
  border: 1px solid rgba(232,149,74,.35); color: var(--accent, #38bdf8);
  background: var(--grad-soft, rgba(232,149,74,.1)); transition: .15s;
}
.ns-btn:hover { border-color: var(--accent, #38bdf8); background: rgba(232,149,74,.18); }
.ns-btn i { font-size: 15px; }
</style>
