<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useLoadingStore } from '@/stores/loading'
import { useAuthStore } from '@/stores/auth'
import { useUserStore } from '@/stores/user'
import { useEventyayApi } from '@/stores/eventyayapi'
import StandardButton from '@/components/Common/StandardButton.vue'

// stores
const loadingStore = useLoadingStore()
const authStore = useAuthStore()
const userStore = useUserStore()
const processApi = useEventyayApi()

const email = ref('')
const password = ref('')
const showError = ref(false)
// router
const router = useRouter()

if(processApi.apitoken) {
	if(processApi.selectedRole === "Exhibitor") {
		router.push({
			name: 'leadscan'
		})
	} else if(processApi.selectedRole === "CheckIn") {
		router.push({
			name: 'eventyaycheckin'
		})
	} else if(processApi.selectedRole === "Badge Station") {
		router.push({
			name: 'eventyaysearchcheckin'
		})
	}
}

async function submitLogin() {
  loadingStore.contentLoading()
  showError.value = false

  const payload = {
    email: email.value,
    password: password.value
  }

  await authStore
    .login(payload)
    .then(async () => {
      await userStore.getUserDetails()
      router.push({
        name: 'selectStation'
      })
    })
    .catch((err) => {
      showError.value = true
    })

  loadingStore.contentLoaded()
}

function registerDevice() {
  processApi.setServer('eventyay.com')
  router.push({
    name: 'device'
  })
}

function handleRoleSelection(role) {
  processApi.setRole(role)
  registerDevice() // Store the selected role in the store
}

onMounted(() => {
  if (authStore.isAuthenticated) {
    router.push({
      name: 'selectStation'
    })
  }

  loadingStore.contentLoaded()
})
</script>

<template>
  <div class="-mt-16 flex h-screen flex-col justify-center">
    <div class="my-auto sm:mx-auto sm:w-full sm:max-w-sm">
      <h2 class="text-center">Select Purpose</h2>
      <div class="mt-10 space-y-3">
        <div>
          <StandardButton
            type="button"
            text="I am an Exhibitor"
            class="btn-primary mt-6 w-full justify-center"
            @click="handleRoleSelection('Exhibitor')"
          />
        </div>
        <div>
          <StandardButton
            type="button"
            text="I am a Checkin Staff"
            class="btn-primary mt-6 w-full justify-center"
            @click="handleRoleSelection('CheckIn')"
          />
        </div>
        <div>
          <StandardButton
            type="button"
            text="Badge Printing Station"
            class="btn-primary mt-6 w-full justify-center"
            @click="handleRoleSelection('Badge Station')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
