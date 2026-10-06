<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useLoadingStore } from '@/stores/loading'
import { useleedauth } from '@/stores/leedauth'

const { t } = useI18n()
const loadingStore = useLoadingStore()
const leedauth = useleedauth()
const router = useRouter()

const password = ref('')
const showError = ref(false)
const errorMessage = ref('')

async function submitLogin() {
  showError.value = false
  errorMessage.value = ''
  const response = await leedauth.leedlogin({ key: password.value })
  if (response.success) {
    router.push({ name: 'leadscan' })
  } else {
    errorMessage.value =
      String(response?.error || 'Invalid exhibitor key or exhibitor not found.').trim()
    showError.value = true
  }
}

loadingStore.contentLoaded()
</script>

<template>
  <div class="page-shell flex min-h-[calc(100vh-2.75rem)] items-center justify-center py-10">
    <div class="card w-full max-w-md p-6 sm:p-8">
      <div class="mb-6 text-center">
        <h1>{{ t('exhibitor.signin_title') }}</h1>
        <p class="mt-2 text-sm text-body-muted">{{ t('exhibitor.signin_subtitle') }}</p>
      </div>

      <form class="space-y-4" @submit.prevent="submitLogin">
        <div>
          <label for="exhibitor-key">{{ t('exhibitor.exhibitor_key') }}</label>
          <input
            id="exhibitor-key"
            v-model="password"
            type="password"
            autocomplete="current-password"
            required
            class="mt-1"
          />
        </div>

        <StandardButton
          type="submit"
          :text="t('common.continue')"
          class="btn-primary w-full justify-center py-2.5"
        />

        <p v-if="showError" class="text-sm text-danger">
          {{ errorMessage }}
        </p>
      </form>
    </div>
  </div>
</template>
