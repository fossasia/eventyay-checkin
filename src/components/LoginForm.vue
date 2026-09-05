<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import QRCamera from '@/components/Utilities/QRCamera.vue'
import StandardButton from '@/components/Common/StandardButton.vue'
import OriginWebsiteField from '@/components/Common/OriginWebsiteField.vue'
import KioskLauncherInstructions from '@/components/Common/KioskLauncherInstructions.vue'
import { useCameraStore } from '@/stores/camera'
import { useEventyayApi } from '@/stores/eventyayapi'
import { useleedauth } from '@/stores/leedauth'
import { useLoadingStore } from '@/stores/loading'
import { DEFAULT_ORIGIN_WEBSITE, resolveOriginWebsite } from '@/utils/originWebsites'
import { getEventyayLogoProps, getRoleLabel, getRoleRouteName, STATION_TYPE_DEFINITIONS } from '@/utils/session'
import { isRoleAllowedForProfile, getAllowedRolesForProfile } from '@/utils/deviceProfiles'
import { buildKioskUrl, isKioskEnvironment } from '@/utils/kioskLauncher'
import { UserGroupIcon, PrinterIcon, BuildingStorefrontIcon } from '@heroicons/vue/24/outline'

const loadingStore = useLoadingStore()
const processApi = useEventyayApi()
const leedauth = useleedauth()
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

const roles = computed(() => {
  const allRoles = STATION_TYPE_DEFINITIONS.map((station) => ({
    ...station,
    icon: ROLE_ICONS[station.id]
  }))

  if (!processApi.apitoken) {
    return allRoles
  }

  const allowedRoles = getAllowedRolesForProfile(processApi.securityProfile)
  if (!allowedRoles) {
    return allRoles
  }

  return allRoles.filter((station) => allowedRoles.includes(station.id))
})

const pendingStationLabel = computed(() => {
  if (!pendingRole.value) {
    return ''
  }
  const station = STATION_TYPE_DEFINITIONS.find((item) => item.id === pendingRole.value)
  return station?.title || getRoleLabel(pendingRole.value)
})

const isRegisteringDevice = computed(
  () => showScanner.value || showKioskPrereq.value
)

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

// Only checked right after a fresh device registration, so an already-registered device's
// picked mode never gets second-guessed later — the security profile is for access clearance,
// it should not change how an established session behaves.
function redirectAfterRegistration(role) {
  if (!isRoleAllowedForProfile(role, processApi.securityProfile)) {
    router.push({ name: 'profileMismatch' })
    return
  }
  redirectForRole(role)
}

async function redirectAfterExhibitorRegistration(role) {
  if (!isRoleAllowedForProfile(role, processApi.securityProfile)) {
    router.push({ name: 'profileMismatch' })
    return
  }

  if (!processApi.eventSlug) {
    redirectForRole(role)
    return
  }

  const response = await leedauth.loginWithPendingKey()
  if (response.success) {
    router.push({ name: 'leadscan' })
    return
  }
  redirectForRole(role)
}

function handleRoleSelection(role) {
  pendingRole.value = role
  showError.value = false
  showKioskPrereq.value = false

  if (!processApi.apitoken) {
    processApi.setRole(role)
    if (role === 'Badge Station' && !isKioskShell.value) {
      showKioskPrereq.value = true
      return
    }
    showScanner.value = true
    return
  }

  if (!isRoleAllowedForProfile(role, processApi.securityProfile)) {
    processApi.setRole(role)
    router.push({ name: 'profileMismatch' })
    return
  }

  processApi.applyStationTypeChange(role)
  processApi.setRole(role)
  redirectForRole(role)
}

function proceedToDeviceRegistration() {
  showKioskPrereq.value = false
  showScanner.value = true
}

function backToStationSelection() {
  showScanner.value = false
  showKioskPrereq.value = false
  showManualInput.value = false
  pendingRole.value = ''
  showError.value = false
  errmessage.value = ''
  cameraStore.clearLastScan()
  if (!processApi.apitoken) {
    processApi.setRole('')
  }
}

async function handleQrScanned() {
  showError.value = false
  loadingStore.contentLoading()

  try {
    const result = await processApi.registerDeviceByQr(cameraStore.qrCodeValue)
    if (result.success) {
      showScanner.value = false
      redirectAfterRegistration(pendingRole.value || processApi.selectedRole)
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
const originWebsite = ref(DEFAULT_ORIGIN_WEBSITE)
const customOriginUrl = ref('')
const manualToken = ref('')
const manualExhibitorKey = ref('')
const isExhibitorRegistration = computed(() => pendingRole.value === 'Exhibitor')

async function handleManualRegister() {
  const urlVal = resolveOriginWebsite(originWebsite.value, customOriginUrl.value)
  const tokenVal = manualToken.value.trim()
  const exhibitorKey = isExhibitorRegistration.value ? manualExhibitorKey.value.trim() : ''

  if (!urlVal || !tokenVal) {
    errmessage.value = 'Please provide both the origin website and setup token.'
    showError.value = true
    return
  }

  showError.value = false
  loadingStore.contentLoading()

  try {
    const result = await processApi.registerDeviceManually(urlVal, tokenVal)
    if (result.success) {
      processApi.setPendingExhibitorKey(exhibitorKey)
      showScanner.value = false
      showManualInput.value = false
      const role = pendingRole.value || processApi.selectedRole
      if (role === 'Exhibitor' && exhibitorKey) {
        await redirectAfterExhibitorRegistration(role)
      } else {
        redirectAfterRegistration(role)
      }
    } else if (result.error === 'invalid_url') {
      errmessage.value = 'Invalid origin website. Please enter a valid URL.'
      showError.value = true
    } else if (result.message) {
      errmessage.value = result.message
      showError.value = true
    } else {
      errmessage.value = 'Registration failed. Please check the origin website and setup token.'
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

onMounted(() => {
  if (processApi.apitoken) {
    void processApi.syncDeviceInfo()
  }
})

loadingStore.contentLoaded()
</script>

<template>
  <div class="page-shell flex min-h-screen items-center justify-center py-10">
    <div class="card w-full max-w-lg p-6 sm:p-8">
      <div class="mb-8 text-center">
        <img v-bind="getEventyayLogoProps('full', 'mx-auto mb-4 h-10 w-auto max-w-[220px]')" />
        <h1>Check-in</h1>
        <p class="mt-2 text-sm text-body-muted">
          {{
            isRegisteringDevice
              ? `Register this device as ${pendingStationLabel}.`
              : 'Choose a station type to get started.'
          }}
        </p>
      </div>

      <Transition name="fade" mode="out-in">
        <div v-if="showKioskPrereq" key="kiosk-prereq" class="space-y-4">
          <div
            v-if="pendingStationLabel"
            class="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
          >
            <p class="min-w-0 text-sm text-body">
              <span class="text-body-muted">Station type</span>
              <span class="mx-1.5 text-body-muted">·</span>
              <span class="font-semibold">{{ pendingStationLabel }}</span>
            </p>
            <button
              type="button"
              class="shrink-0 text-xs font-semibold text-primary hover:underline focus:outline-none"
              @click="backToStationSelection"
            >
              Change
            </button>
          </div>

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
        </div>

        <div v-else-if="showScanner" key="scanner" class="space-y-4">
          <div
            v-if="pendingStationLabel"
            class="flex items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2"
          >
            <p class="min-w-0 text-sm text-body">
              <span class="text-body-muted">Station type</span>
              <span class="mx-1.5 text-body-muted">·</span>
              <span class="font-semibold">{{ pendingStationLabel }}</span>
            </p>
            <button
              type="button"
              class="shrink-0 text-xs font-semibold text-primary hover:underline focus:outline-none"
              @click="backToStationSelection"
            >
              Change
            </button>
          </div>

          <div v-if="!showManualInput" class="space-y-4">
            <div class="rounded-xl border border-surface-border bg-surface-muted p-4 text-center">
              <p class="text-sm font-medium text-body">Scan device registration QR</p>
              <p class="mt-1 text-xs text-body-muted">
                The QR code includes your server URL and setup token from the Eventyay organizer dashboard.
              </p>
            </div>
            <QRCamera @scanned="handleQrScanned" />
            <div class="text-center py-1">
              <button
                type="button"
                class="text-sm font-semibold text-primary hover:underline focus:outline-none"
                @click="showManualInput = true"
              >
                Or enter URL and Token manually
              </button>
            </div>
          </div>

          <div v-else class="space-y-4">
            <div class="rounded-xl border border-surface-border bg-surface-muted p-4 text-center">
              <p class="text-sm font-medium text-body">Manual Device Registration</p>
              <p class="mt-1 text-xs text-body-muted">
                Use the same URL as shown in the organizer device setup page (System URL), not the check-in app address.
              </p>
            </div>
            <div class="space-y-3 text-left">
              <OriginWebsiteField v-model:selected="originWebsite" v-model:custom-url="customOriginUrl" />
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
              <div v-if="isExhibitorRegistration">
                <label for="manual-exhibitor-key" class="block text-xs font-semibold text-body-muted uppercase">
                  Exhibitor key
                </label>
                <input
                  id="manual-exhibitor-key"
                  v-model="manualExhibitorKey"
                  type="password"
                  autocomplete="off"
                  placeholder="Optional — you can also enter this after event selection"
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
              <p class="font-semibold text-body">{{ role.buttonLabel }}</p>
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
