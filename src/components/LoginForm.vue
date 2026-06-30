<script setup>
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCamera from '@/components/Utilities/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import KioskLauncherInstructions from '@/components/Common/KioskLauncherInstructions.vue'
import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useLoadingStore } from '@/stores/loading'
import { getEventyayLogoProps, getRoleRouteName, STATION_TYPE_DEFINITIONS } from '@/utils/session'
import { buildKioskUrl, isKioskEnvironment } from '@/utils/kioskLauncher'
import { UserGroupIcon, PrinterIcon, BuildingStorefrontIcon } from '@heroicons/vue/24/outline'

const loadingStore = useLoadingStore()
const processApi = useEventyayApi()
const cameraStore = useCameraStore()
const router = useRouter()
const route = useRoute()

const errmessage = ref('')
const showError = ref(false)
const showScanner = ref(false)
const showKioskPrereq = ref(false)
const pendingRole = ref('')
const isKioskShell = computed(() => isKioskEnvironment(route))
const kioskLoginUrl = computed(() => buildKioskUrl(window.location.origin, '/'))

const ROLE_ICONS = {
  CheckIn: UserGroupIcon,
  'Badge Station': PrinterIcon,
  Exhibitor: BuildingStorefrontIcon
}

const roles = STATION_TYPE_DEFINITIONS.map((station) => ({
  ...station,
  icon: ROLE_ICONS[station.id]
}))

function redirectForRole(role) {
  const routeName = getRoleRouteName(role)
  if (!routeName) {
    return
  }

  if (processApi.eventSlug) {
    router.push({ name: routeName })
  } else {
    router.push({ name: 'eventyayevents' })
  }
}

function handleRoleSelection(role) {
  pendingRole.value = role
  processApi.setRole(role)
  showError.value = false
  showKioskPrereq.value = false

  if (!processApi.apitoken) {
    if (role === 'Badge Station' && !isKioskShell.value) {
      showKioskPrereq.value = true
      return
    }
    showScanner.value = true
    return
  }

  redirectForRole(role)
}

function proceedToDeviceRegistration() {
  showKioskPrereq.value = false
  showScanner.value = true
}

function backFromKioskPrereq() {
  showKioskPrereq.value = false
  pendingRole.value = ''
}

async function handleQrScanned() {
  showError.value = false
  loadingStore.contentLoading()

  try {
    const result = await processApi.registerDeviceByQr(cameraStore.qrCodeValue)
    if (result.success) {
      showScanner.value = false
      redirectForRole(pendingRole.value || processApi.selectedRole)
    } else if (result.error === 'unsupported_handshake') {
      errmessage.value = 'This QR code requires a newer version of the check-in app.'
      showError.value = true
    } else if (result.message) {
      errmessage.value = result.message
      showError.value = true
    } else {
      errmessage.value = 'Invalid device QR code. Please scan the registration QR from your organizer dashboard.'
      showError.value = true
    }
  } catch (error) {
    console.error('Scan registration error:', error)
    errmessage.value = 'Failed to register this device.'
    showError.value = true
  } finally {
    cameraStore.clearLastScan()
    loadingStore.contentLoaded()
  }
}

const showManualInput = ref(false)
const manualUrl = ref('')
const manualToken = ref('')
const serverUrlPlaceholder = 'https://eventyay.com'

async function handleManualRegister() {
  const urlVal = manualUrl.value.trim()
  const tokenVal = manualToken.value.trim()

  if (!urlVal || !tokenVal) {
    errmessage.value = 'Please provide both the Server URL and Setup Token.'
    showError.value = true
    return
  }

  showError.value = false
  loadingStore.contentLoading()

  try {
    const result = await processApi.registerDeviceManually(urlVal, tokenVal)
    if (result.success) {
      showScanner.value = false
      showManualInput.value = false
      redirectForRole(pendingRole.value || processApi.selectedRole)
    } else if (result.error === 'invalid_url') {
      errmessage.value = 'Invalid Server URL. Please enter a valid URL.'
      showError.value = true
    } else if (result.message) {
      errmessage.value = result.message
      showError.value = true
    } else {
      errmessage.value = 'Registration failed. Please check the Server URL and Setup Token.'
      showError.value = true
    }
  } catch (error) {
    console.error('Manual registration error:', error)
    errmessage.value = 'Failed to register this device.'
    showError.value = true
  } finally {
    loadingStore.contentLoaded()
  }
}

loadingStore.contentLoaded()
</script>

<template>
  <div class="page-shell flex min-h-screen items-center justify-center py-10">
    <div class="card w-full max-w-lg p-6 sm:p-8">
      <div class="mb-8 text-center">
        <img v-bind="getEventyayLogoProps('full', 'mx-auto mb-4 h-10 w-auto max-w-[220px]')" />
        <h1>Check-in</h1>
        <p class="mt-2 text-sm text-body-muted">Choose a station type to get started.</p>
      </div>

      <Transition name="fade" mode="out-in">
        <div v-if="showKioskPrereq" key="kiosk-prereq" class="space-y-4">
          <div class="rounded-xl border border-surface-border bg-surface-muted p-4 text-center">
            <p class="text-sm font-medium text-body">Set up kiosk mode before registering</p>
            <p class="mt-1 text-xs text-body-muted">
              Kiosk mode enables silent badge printing. Run the command below, then register in that
              window.
            </p>
          </div>

          <KioskLauncherInstructions
            :target-url="kioskLoginUrl"
            :show-registration-steps="true"
          />

          <StandardButton
            type="button"
            text="I'm in kiosk mode — register device"
            variant="primary"
            block
            @click="proceedToDeviceRegistration"
          />
          <StandardButton
            type="button"
            text="Back"
            variant="white"
            block
            @click="backFromKioskPrereq"
          />
        </div>

        <div v-else-if="showScanner" key="scanner" class="space-y-4">
          <div v-if="!showManualInput" class="space-y-4">
            <div class="rounded-xl border border-surface-border bg-surface-muted p-4 text-center">
              <p class="text-sm font-medium text-body">Scan device registration QR</p>
              <p class="mt-1 text-xs text-body-muted">
                The QR code includes your server URL and setup token from the Eventyay organizer dashboard.
              </p>
            </div>
            <QRCamera keep-active @scanned="handleQrScanned" />
            <div class="text-center py-1">
              <button
                type="button"
                class="text-sm font-semibold text-primary hover:underline focus:outline-none"
                @click="showManualInput = true"
              >
                Or enter URL and Token manually
              </button>
            </div>
            <StandardButton
              type="button"
              text="Back"
              variant="white"
              block
              @click="showScanner = false"
            />
          </div>

          <div v-else class="space-y-4">
            <div class="rounded-xl border border-surface-border bg-surface-muted p-4 text-center">
              <p class="text-sm font-medium text-body">Manual Device Registration</p>
              <p class="mt-1 text-xs text-body-muted">
                Use the same URL as shown in the organizer device setup page (System URL), not the check-in app address.
              </p>
            </div>
            <div class="space-y-3 text-left">
              <div>
                <label for="manual-url" class="block text-xs font-semibold text-body-muted uppercase">Server URL</label>
                <input
                  id="manual-url"
                  v-model="manualUrl"
                  type="text"
                  :placeholder="serverUrlPlaceholder"
                  class="mt-1 block w-full rounded-xl border border-surface-border bg-surface-muted px-3 py-2 text-sm text-body focus:border-primary focus:outline-none"
                />
              </div>
              <div>
                <label for="manual-token" class="block text-xs font-semibold text-body-muted uppercase">Setup Token</label>
                <input
                  id="manual-token"
                  v-model="manualToken"
                  type="password"
                  placeholder="Enter your registration token"
                  class="mt-1 block w-full rounded-xl border border-surface-border bg-surface-muted px-3 py-2 text-sm text-body focus:border-primary focus:outline-none"
                />
              </div>
            </div>
            <div class="flex gap-2">
              <StandardButton
                type="button"
                text="Scan QR"
                variant="white"
                block
                @click="showManualInput = false"
              />
              <StandardButton
                type="button"
                text="Register"
                variant="primary"
                block
                @click="handleManualRegister"
              />
            </div>
          </div>
        </div>

        <div v-else key="roles" class="space-y-3">
          <p class="section-title">Station type</p>
          <button
            v-for="role in roles"
            :key="role.id"
            type="button"
            class="btn-role"
            @click="handleRoleSelection(role.id)"
          >
            <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <component :is="role.icon" class="h-5 w-5" width="20" height="20" style="width: 20px; height: 20px;" />
            </div>
            <div>
              <p class="font-semibold text-body">{{ role.title }}</p>
              <p class="mt-0.5 text-sm text-body-muted">{{ role.description }}</p>
            </div>
          </button>
        </div>
      </Transition>

      <div
        v-if="showError"
        class="mt-5 rounded-xl border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger"
      >
        {{ errmessage }}
      </div>
    </div>
  </div>
</template>
