<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import StandardButton from '@/components/Common/StandardButton.vue'
import {
  buildChromeKioskCommand,
  buildFirefoxKioskCommand,
  getPlatformLabel,
  getShellLabel
} from '@/utils/kioskLauncher'
import { useNotificationStore } from '@/stores/notification'

const props = defineProps({
  targetUrl: {
    type: String,
    required: true
  },
  intro: {
    type: String,
    default: ''
  },
  showRegistrationSteps: {
    type: Boolean,
    default: false
  }
})

const { t } = useI18n()
const notificationStore = useNotificationStore()
const copiedKioskCommand = ref('')
const chromeKioskCommand = computed(() => buildChromeKioskCommand(props.targetUrl))
const firefoxKioskCommand = computed(() => buildFirefoxKioskCommand(props.targetUrl))
const kioskPlatformLabel = computed(() => getPlatformLabel())
const kioskShellLabel = computed(() => getShellLabel())

async function copyKioskCommand(command, label) {
  try {
    await navigator.clipboard.writeText(command)
    copiedKioskCommand.value = label
    setTimeout(() => {
      copiedKioskCommand.value = ''
    }, 2000)
  } catch {
    notificationStore.addNotification(
      [t('kiosk.copy_failed_title'), t('kiosk.copy_failed_desc')],
      'warning'
    )
  }
}
</script>

<template>
  <div>
    <p v-if="intro" class="text-center text-xs text-body-muted leading-relaxed">
      {{ intro }}
    </p>
    <p v-else class="text-center text-xs text-body-muted leading-relaxed">
      {{ t('kiosk.platform_commands', { platform: kioskPlatformLabel, shell: kioskShellLabel }) }}
    </p>

    <ol
      v-if="showRegistrationSteps"
      class="mt-3 space-y-2 text-left text-xs leading-relaxed text-body-muted list-decimal list-inside"
    >
      <li>{{ t('kiosk.step_copy_chrome') }}</li>
      <li>{{ t('kiosk.step_register_in_window') }}</li>
    </ol>

    <ul v-else class="mt-3 space-y-1.5 text-left text-xs leading-relaxed text-body-muted">
      <li class="flex gap-2">
        <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span>{{ t('kiosk.feature_fullscreen') }}</span>
      </li>
      <li class="flex gap-2">
        <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span>{{ t('kiosk.feature_silent_print') }}</span>
      </li>
      <li class="flex gap-2">
        <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span>{{ t('kiosk.feature_browser_profile') }}</span>
      </li>
    </ul>

    <div class="mt-4 space-y-3 text-left">
      <div class="rounded-xl border border-surface-border bg-surface-muted p-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <p class="text-xs font-semibold text-body">Google Chrome</p>
          <span
            class="rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary"
          >
            {{ t('common.recommended') }}
          </span>
        </div>
        <pre
          class="mt-2 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 text-[10px] leading-snug text-body"
        >{{ chromeKioskCommand }}</pre>
        <StandardButton
          type="button"
          :text="copiedKioskCommand === 'chrome' ? t('common.copied') : t('kiosk.copy_chrome_command')"
          class="btn-primary mt-2 w-full justify-center"
          size="sm"
          @click="copyKioskCommand(chromeKioskCommand, 'chrome')"
        />
      </div>

      <div class="rounded-xl border border-surface-border bg-surface-muted p-3">
        <p class="text-xs font-semibold text-body">Mozilla Firefox</p>
        <pre
          class="mt-2 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 text-[10px] leading-snug text-body"
        >{{ firefoxKioskCommand }}</pre>
        <StandardButton
          type="button"
          :text="copiedKioskCommand === 'firefox' ? t('common.copied') : t('kiosk.copy_firefox_command')"
          class="btn-white mt-2 w-full justify-center"
          size="sm"
          @click="copyKioskCommand(firefoxKioskCommand, 'firefox')"
        />
      </div>
    </div>
  </div>
</template>
