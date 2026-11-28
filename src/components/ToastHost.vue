<script setup>
import { toasts, dismissToast } from '../lib/toast.js'
import { T } from '../lib/i18n.dev.js'
</script>

<template>
  <div class="toast-host" aria-live="polite" aria-atomic="false">
    <transition-group name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="[t.type, { leaving: t.leaving }]" role="status">
        <i class="bi" :class="{
          ok: 'bi-check-circle-fill',
          err: 'bi-exclamation-triangle-fill',
          info: 'bi-info-circle-fill',
        }[t.type] || 'bi-info-circle-fill'"></i>
        <span class="toast-text">{{ t.text }}</span>
        <button class="toast-x" @click="dismissToast(t.id)" :aria-label="T('ui.toasthost.close')"><i class="bi bi-x"></i></button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-host {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 60;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: min(92vw, 360px);
  pointer-events: none;
}
.toast {
  pointer-events: auto;
  display: flex;
  align-items: flex-start;
  gap: 9px;
  padding: 11px 12px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--txt);
  background: var(--panel-solid);
  border: 1px solid var(--line-strong);
  box-shadow: var(--shadow);
  backdrop-filter: blur(8px);
}
.toast i { font-size: 15px; margin-top: 1px; flex: none; }
.toast.ok i { color: var(--accent-2); }
.toast.err i { color: var(--danger); }
.toast.info i { color: var(--accent); }
.toast-text { flex: 1; word-break: break-word; }
.toast-x {
  flex: none; border: none; background: transparent; color: var(--muted);
  cursor: pointer; font-size: 14px; padding: 0 2px; line-height: 1;
}
.toast-x:hover { color: var(--txt); }

.toast-enter-active, .toast-leave-active { transition: .2s ease; }
.toast-enter-from { opacity: 0; transform: translateY(10px); }
.toast-leave-to { opacity: 0; transform: translateX(20px); }
</style>
