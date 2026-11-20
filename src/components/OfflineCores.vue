<script setup>
// 离线内核管理面板（A-3）。
// 让用户按需把 WASM 内核（压缩/OCR/媒体）缓存到本地，实现"真正的离线可用"，
// 而不是仅在首次联网使用时被动缓存。与 public/sw.js 的 PRECACHE_CORES 协议对接。
import { ref, computed, onMounted } from 'vue'
import { swSupported, precacheCores, coreStatus, clearCores, CORE_GROUPS_META, CORE_GROUP_IDS } from '../lib/offline.js'
import { t } from '../lib/i18n.js'

const supported = swSupported()
const status = ref(null)          // { groupId: { cached, total, ready } }
const busy = ref(false)
const progress = ref({ done: 0, total: 0, bytes: 0 })
const note = ref('')

const groups = computed(() =>
  CORE_GROUPS_META.map((g) => ({ ...g, st: (status.value || {})[g.id] || { cached: 0, total: 0, ready: false } })))

const readyCount = computed(() => groups.value.filter((g) => g.st.ready).length)
const pct = computed(() => (progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0))
const human = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB')

async function refresh() {
  if (!supported) return
  status.value = await coreStatus()
}
async function fetchGroup(id) {
  if (busy.value || !supported) return
  busy.value = true
  progress.value = { done: 0, total: 0, bytes: 0 }
  note.value = ''
  const res = await precacheCores([id], (p) => { progress.value = p })
  await refresh()
  busy.value = false
  note.value = res && !res.error ? t('offline.done', { n: res.done, size: human(res.bytes || 0) }) : t('offline.failed')
}
async function fetchAll() {
  if (busy.value || !supported) return
  busy.value = true
  progress.value = { done: 0, total: 0, bytes: 0 }
  note.value = ''
  const res = await precacheCores(CORE_GROUP_IDS, (p) => { progress.value = p })
  await refresh()
  busy.value = false
  note.value = res && !res.error ? t('offline.done', { n: res.done, size: human(res.bytes || 0) }) : t('offline.failed')
}
async function wipe() {
  if (busy.value || !supported) return
  busy.value = true
  await clearCores()
  await refresh()
  progress.value = { done: 0, total: 0, bytes: 0 }
  busy.value = false
  note.value = t('offline.cleared')
}

onMounted(refresh)
</script>

<template>
  <div class="panel offline">
    <div class="offline-head">
      <h3 style="margin:0"><i class="bi bi-cloud-arrow-down"></i> {{ t('offline.title') }}</h3>
      <span class="badge" :class="{ ok: readyCount > 0 }">
        <i class="bi" :class="readyCount > 0 ? 'bi-check-circle' : 'bi-circle'"></i>
        {{ readyCount }}/{{ groups.length }}
      </span>
    </div>
    <p class="offline-desc">{{ t('offline.desc') }}</p>

    <p v-if="!supported" class="offline-warn"><i class="bi bi-exclamation-triangle"></i> {{ t('offline.unsupported') }}</p>

    <div v-else class="grid">
      <div v-for="g in groups" :key="g.id" class="card" :class="{ ready: g.st.ready }">
        <div class="card-main">
          <span class="name">{{ g.label }}</span>
          <span class="size">{{ g.size }}</span>
        </div>
        <span class="state" :class="{ ready: g.st.ready }">
          <i class="bi" :class="g.st.ready ? 'bi-check-circle-fill' : 'bi-download'"></i>
          <template v-if="g.st.ready">{{ t('offline.ready') }}</template>
          <template v-else>{{ g.st.cached }}/{{ g.st.total }}</template>
        </span>
        <button class="btn ghost sm" :disabled="busy || g.st.ready" @click="fetchGroup(g.id)">
          <i class="bi" :class="g.st.ready ? 'bi-check-lg' : 'bi-cloud-download'"></i>
          {{ g.st.ready ? t('offline.cached') : t('offline.fetch') }}
        </button>
      </div>
    </div>

    <div v-if="busy" class="prog">
      <div class="prog-bar"><span :style="{ width: pct + '%' }"></span></div>
      <span class="prog-txt">{{ progress.done }}/{{ progress.total }} · {{ pct }}% · {{ human(progress.bytes || 0) }}</span>
    </div>

    <p v-if="note" class="note">{{ note }}</p>

    <div v-if="supported" class="actions">
      <button class="btn sm" :disabled="busy" @click="fetchAll">
        <i class="bi bi-cloud-download"></i> {{ t('offline.fetchAll') }}
      </button>
      <button class="btn ghost sm" :disabled="busy || readyCount === 0" @click="wipe">
        <i class="bi bi-trash3"></i> {{ t('offline.clear') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.offline-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
.offline-head h3 { font-size: 15px; display: flex; align-items: center; gap: 8px; }
.offline-head h3 i { color: var(--accent, #38bdf8); }
.badge {
  display: inline-flex; align-items: center; gap: 5px; font-size: 12px; padding: 3px 10px;
  border-radius: 999px; border: 1px solid var(--line, rgba(120,150,200,.16)); color: var(--muted, #93a2bd);
}
.badge.ok { color: var(--accent-2, #34d399); border-color: rgba(52,211,153,.4); background: rgba(52,211,153,.08); }
.offline-desc { color: var(--muted, #93a2bd); font-size: 13px; line-height: 1.7; margin: 0 0 14px; }
.offline-warn { color: #fbbf24; font-size: 13px; margin: 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px; }
.card {
  display: flex; align-items: center; gap: 10px; padding: 11px 12px; border-radius: 11px;
  border: 1px solid var(--line, rgba(120,150,200,.16)); background: var(--panel-2, rgba(28,37,60,.55));
}
.card.ready { border-color: rgba(52,211,153,.35); background: rgba(52,211,153,.06); }
.card-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.name { font-size: 13px; font-weight: 600; color: var(--txt, #e8edf7); }
.size { font-size: 11.5px; color: var(--faint, #6b7a96); }
.state { font-size: 12px; color: var(--muted, #93a2bd); display: inline-flex; align-items: center; gap: 4px; flex: none; }
.state.ready { color: var(--accent-2, #34d399); }
.btn.sm { padding: 5px 10px; font-size: 12px; flex: none; }
.prog { margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.prog-bar { height: 6px; border-radius: 999px; background: rgba(120,150,200,.18); overflow: hidden; }
.prog-bar span { display: block; height: 100%; background: var(--grad, linear-gradient(90deg,#38bdf8,#a78bfa)); transition: width .2s; }
.prog-txt { font-size: 12px; color: var(--muted, #93a2bd); font-variant-numeric: tabular-nums; }
.note { margin: 12px 0 0; font-size: 12.5px; color: var(--accent-2, #34d399); }
.actions { display: flex; gap: 9px; margin-top: 14px; flex-wrap: wrap; }
</style>
