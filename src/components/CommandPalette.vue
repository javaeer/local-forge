<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { NAV, NAV_GROUPS, searchNav, navTitle, groupLabel } from '../lib/nav.js'
import { t } from '../lib/i18n.js'

const props = defineProps({ open: { type: Boolean, default: false } })
const emit = defineEmits(['update:open'])
const router = useRouter()

const query = ref('')
const active = ref(0)
const inputEl = ref(null)

const results = computed(() => searchNav(query.value))
const grouped = computed(() => {
  const map = {}
  for (const n of results.value) (map[n.group] = map[n.group] || []).push(n)
  return NAV_GROUPS.filter((g) => map[g]).map((g) => ({ group: g, items: map[g] }))
})
// 扁平列表用于键盘上下选择
const flat = computed(() => grouped.value.flatMap((g) => g.items))

watch(() => props.open, (v) => {
  if (v) {
    query.value = ''
    active.value = 0
    nextTick(() => inputEl.value && inputEl.value.focus())
  }
})
watch(results, () => { active.value = 0 })

function close() { emit('update:open', false) }
function go(n) {
  if (!n) return
  router.push(n.path)
  close()
}
function onKey(e) {
  if (e.key === 'ArrowDown') { e.preventDefault(); active.value = Math.min(active.value + 1, flat.value.length - 1) }
  else if (e.key === 'ArrowUp') { e.preventDefault(); active.value = Math.max(active.value - 1, 0) }
  else if (e.key === 'Enter') { e.preventDefault(); go(flat.value[active.value]) }
  else if (e.key === 'Escape') { e.preventDefault(); close() }
}
function onInput() {
  // 输入时若高亮项超出结果范围则归零
  if (active.value >= flat.value.length) active.value = 0
}
</script>

<template>
  <transition name="palette">
    <div v-if="open" class="palette-scrim" @click.self="close" @keydown="onKey">
      <div class="palette" role="dialog" :aria-label="t('app.search')" aria-modal="true">
        <div class="p-input">
          <i class="bi bi-search"></i>
          <input
            ref="inputEl"
            v-model="query"
            @input="onInput"
            @keydown.stop="onKey"
            type="text"
            :placeholder="t('app.searchPlaceholder')"
            :aria-label="t('app.search')"
          />
          <kbd class="p-esc">Esc</kbd>
        </div>
        <div class="p-list">
          <template v-for="g in grouped" :key="g.group">
            <div class="p-group">{{ groupLabel(g.group) }}</div>
            <button
              v-for="n in g.items"
              :key="n.path"
              class="p-item"
              :class="{ active: flat.indexOf(n) === active }"
              @mouseenter="active = flat.indexOf(n)"
              @click="go(n)"
            >
              <i class="bi" :class="n.icon"></i>
              <span class="p-title">{{ navTitle(n) }}</span>
              <span class="p-path">{{ n.path }}</span>
            </button>
          </template>
          <div v-if="!flat.length" class="p-empty">{{ t('app.noResults') }}</div>
        </div>
        <div class="p-foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> {{ t('app.keySelect') }}</span>
          <span><kbd>↵</kbd> {{ t('app.keyOpen') }}</span>
          <span><kbd>Esc</kbd> {{ t('app.keyClose') }}</span>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.palette-scrim {
  position: fixed; inset: 0; z-index: 70;
  background: rgba(4, 8, 16, 0.5);
  backdrop-filter: blur(3px);
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 12vh;
}
.palette {
  width: min(92vw, 560px);
  background: var(--panel-solid);
  border: 1px solid var(--line-strong);
  border-radius: 16px;
  box-shadow: var(--shadow);
  overflow: hidden;
}
.p-input {
  display: flex; align-items: center; gap: 10px;
  padding: 14px 16px; border-bottom: 1px solid var(--line);
}
.p-input i { color: var(--accent); font-size: 18px; }
.p-input input {
  flex: 1; border: none; background: transparent; outline: none;
  color: var(--txt); font-size: 16px;
}
.p-esc { margin-left: auto; }
.p-list { max-height: 52vh; overflow: auto; padding: 8px; }
.p-group {
  font-size: 11.5px; color: var(--faint); text-transform: uppercase; letter-spacing: .6px;
  padding: 10px 10px 4px;
}
.p-item {
  display: flex; align-items: center; gap: 10px; width: 100%;
  padding: 10px 10px; border: none; background: transparent; cursor: pointer;
  border-radius: 10px; color: var(--txt); text-align: left; font-size: 14px;
}
.p-item i { font-size: 17px; color: var(--accent); width: 20px; text-align: center; }
.p-item .p-title { flex: 1; }
.p-item .p-path { font-size: 12px; color: var(--faint); font-family: var(--mono); }
.p-item.active, .p-item:hover { background: var(--grad-soft); }
.p-item.active .p-title { color: var(--accent); }
.p-empty { padding: 20px; text-align: center; color: var(--muted); font-size: 13px; }
.p-foot {
  display: flex; gap: 16px; padding: 9px 14px; border-top: 1px solid var(--line);
  font-size: 12px; color: var(--faint);
}
kbd {
  font-family: var(--mono); font-size: 11px; padding: 1px 6px; border-radius: 5px;
  border: 1px solid var(--line-strong); background: var(--panel-2); color: var(--muted);
}
.palette-enter-active, .palette-leave-active { transition: .16s ease; }
.palette-enter-from, .palette-leave-to { opacity: 0; }
.palette-enter-from .palette, .palette-leave-to .palette { transform: translateY(-10px) scale(.98); }
</style>
