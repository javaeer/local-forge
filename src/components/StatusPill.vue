<script setup>
// state: idle | working | done | error
defineProps({
  state: { type: String, default: 'idle' },
  label: { type: String, default: '' },
})
</script>

<template>
  <span class="statuspill" :class="state">
    <i v-if="state === 'working'" class="bi bi-arrow-repeat spin"></i>
    <i v-else-if="state === 'done'" class="bi bi-check-circle-fill"></i>
    <i v-else-if="state === 'error'" class="bi bi-exclamation-triangle-fill"></i>
    <i v-else class="bi bi-circle-fill dot-idle"></i>
    <span class="sp-label">{{ label }}</span>
  </span>
</template>

<style scoped>
.statuspill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 5px 12px;
  border-radius: 999px;
  font-size: 12.5px;
  border: 1px solid var(--line-strong, rgba(120,150,200,.32));
  background: var(--panel-2, rgba(28,37,60,.6));
  color: var(--muted, #93a2bd);
  font-family: var(--mono, monospace);
  letter-spacing: .2px;
}
.statuspill .spin { animation: spspin .9s linear infinite; }
@keyframes spspin { to { transform: rotate(360deg); } }
.statuspill.working { color: var(--accent, #38bdf8); border-color: rgba(232,149,74,.45); background: rgba(232,149,74,.1); }
.statuspill.done { color: var(--accent-2, #34d399); border-color: rgba(52,211,153,.45); background: rgba(52,211,153,.1); }
.statuspill.error { color: var(--danger, #fb7185); border-color: rgba(251,113,133,.45); background: rgba(251,113,133,.1); }
.statuspill.idle .dot-idle { font-size: 8px; }
</style>
