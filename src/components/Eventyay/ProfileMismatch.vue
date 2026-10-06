<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useEventyayApi } from '@/stores/eventyayapi'
import { getRoleLabel, getRoleRouteName } from '@/utils/session'
import { getSecurityProfileLabel, getSuggestedRoleForProfile } from '@/utils/deviceProfiles'

const { t } = useI18n()
const router = useRouter()
const processApi = useEventyayApi()

const currentRoleLabel = computed(() => getRoleLabel(processApi.selectedRole))
const profileLabel = computed(() => getSecurityProfileLabel(processApi.securityProfile))
const suggestedRole = computed(() => getSuggestedRoleForProfile(processApi.securityProfile))
const suggestedRoleLabel = computed(() => (suggestedRole.value ? getRoleLabel(suggestedRole.value) : ''))

function switchToSuggestedRole() {
  if (!suggestedRole.value) {
    return
  }

  const wasExhibitor = processApi.selectedRole === 'Exhibitor'
  processApi.applyStationTypeChange(suggestedRole.value)
  processApi.setRole(suggestedRole.value)

  if (wasExhibitor || !processApi.eventSlug || !processApi.selectedCheckInListId) {
    router.push({ name: 'eventyayevents' })
    return
  }

  const routeName = getRoleRouteName(suggestedRole.value)
  router.push({ name: routeName || 'eventyayevents' })
}

function signOut() {
  processApi.logout()
}
</script>

<template>
  <div class="page-shell flex min-h-[calc(100vh-2.75rem)] items-center justify-center py-10">
    <div class="card w-full max-w-md p-6 sm:p-8">
      <div class="mb-6 text-center">
        <h1>{{ t('profileMismatch.title') }}</h1>
        <p class="mt-2 text-sm text-body-muted">
          {{ t('profileMismatch.description', { profile: profileLabel, currentRole: currentRoleLabel }) }}
        </p>
      </div>

      <div class="space-y-3">
        <StandardButton
          v-if="suggestedRole"
          type="button"
          :text="t('profileMismatch.switch_button', { suggestedRole: suggestedRoleLabel })"
          variant="primary"
          block
          @click="switchToSuggestedRole"
        />

        <StandardButton
          type="button"
          :text="t('profileMismatch.sign_out')"
          variant="white"
          block
          @click="signOut"
        />
      </div>

      <p class="mt-5 rounded-xl border border-surface-border bg-surface-muted px-4 py-3 text-sm text-body-muted">
        {{ t('profileMismatch.help_text', { currentRole: currentRoleLabel }) }}
      </p>
    </div>
  </div>
</template>
