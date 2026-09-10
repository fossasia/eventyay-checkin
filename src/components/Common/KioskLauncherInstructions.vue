<script setup>
import { computed, ref } from 'vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import {
  buildChromeKioskCommand,
  buildFirefoxKioskCommand,
  getKioskInfo
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

const notificationStore = useNotificationStore()
const copiedKioskCommand = ref('')

const kioskInfo = computed(() => getKioskInfo())
const isMobileOrTablet = computed(() => kioskInfo.value.isMobileOrTablet)
const kioskPlatformLabel = computed(() => kioskInfo.value.platformLabel)
const kioskShellLabel = computed(() => kioskInfo.value.shellLabel)

const chromeKioskCommand = computed(() => buildChromeKioskCommand(props.targetUrl))
const firefoxKioskCommand = computed(() => buildFirefoxKioskCommand(props.targetUrl))

async function copyKioskCommand(command, label) {
  try {
    await navigator.clipboard.writeText(command)
    copiedKioskCommand.value = label
    setTimeout(() => {
      copiedKioskCommand.value = ''
    }, 2000)
  } catch {
    notificationStore.addNotification(
      ['Copy failed', 'Select the command below and copy it manually.'],
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
    <p v-else-if="!isMobileOrTablet" class="text-center text-xs text-body-muted leading-relaxed">
      Commands for {{ kioskPlatformLabel }}. Run one in {{ kioskShellLabel }}, then continue below.
    </p>
    <p v-else class="text-center text-xs text-body-muted leading-relaxed">
      Tablet setup for {{ kioskPlatformLabel }}. Follow the steps below for your browser.
    </p>

    <ol
      v-if="showRegistrationSteps && !isMobileOrTablet"
      class="mt-3 space-y-2 text-left text-xs leading-relaxed text-body-muted list-decimal list-inside"
    >
      <li>Copy and run the Chrome command below to open kiosk mode.</li>
      <li>In that window, register this device.</li>
    </ol>

    <ol
      v-else-if="showRegistrationSteps && isMobileOrTablet"
      class="mt-3 space-y-2 text-left text-xs leading-relaxed text-body-muted list-decimal list-inside"
    >
      <li>Open <code class="rounded bg-surface px-1 py-0.5 text-[11px] text-body">{{ targetUrl }}</code> in your tablet browser.</li>
      <li>Tap Menu (<strong>⋮</strong> or <strong>Share</strong>) and choose <strong>Add to Home Screen</strong> or <strong>Install App</strong>.</li>
      <li>In that window, register this device for kiosk badge station mode.</li>
    </ol>

    <ul v-else-if="!isMobileOrTablet" class="mt-3 space-y-1.5 text-left text-xs leading-relaxed text-body-muted">
      <li class="flex gap-2">
        <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span>Fullscreen kiosk mode</span>
      </li>
      <li class="flex gap-2">
        <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span>Silent printing without a print dialog</span>
      </li>
      <li class="flex gap-2">
        <span class="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden="true" />
        <span>Use the same browser profile you register in</span>
      </li>
    </ul>

    <!-- Tablet / Mobile setup instructions -->
    <div v-if="isMobileOrTablet" class="mt-4 space-y-3 text-left">
      <div class="rounded-xl border border-surface-border bg-surface-muted p-3">
        <p class="text-xs font-semibold text-body">Tablet Kiosk Setup (PWA Mode)</p>
        <ol class="mt-2 space-y-2 text-xs leading-relaxed text-body-muted list-decimal list-inside">
          <li>Open <code class="rounded bg-surface px-1 py-0.5 text-[11px] text-body">{{ targetUrl }}</code> in your browser.</li>
          <li>Tap browser menu (<strong>⋮</strong> or <strong>Share</strong>) and choose <strong>Add to Home Screen</strong> or <strong>Install App</strong>.</li>
          <li>Ensure your default badge printer is paired in tablet system print settings.</li>
          <li>Open the installed app in fullscreen mode for automatic post-scan badge printing.</li>
        </ol>
      </div>
    </div>

    <!-- Desktop commands -->
    <div v-else class="mt-4 space-y-3 text-left">
      <div class="rounded-xl border border-surface-border bg-surface-muted p-3">
        <div class="flex flex-wrap items-center gap-1.5">
          <p class="text-xs font-semibold text-body">Google Chrome</p>
          <span
            class="rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary"
          >
            Recommended
          </span>
        </div>
        <pre
          class="mt-2 overflow-x-auto rounded-lg bg-surface px-2.5 py-1.5 text-[10px] leading-snug text-body"
        >{{ chromeKioskCommand }}</pre>
        <StandardButton
          type="button"
          :text="copiedKioskCommand === 'chrome' ? 'Copied' : 'Copy Chrome command'"
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
          :text="copiedKioskCommand === 'firefox' ? 'Copied' : 'Copy Firefox command'"
          class="btn-white mt-2 w-full justify-center"
          size="sm"
          @click="copyKioskCommand(firefoxKioskCommand, 'firefox')"
        />
      </div>
    </div>
  </div>
</template>

