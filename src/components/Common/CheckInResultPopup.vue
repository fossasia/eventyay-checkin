<script setup>
import { onMounted, computed } from 'vue'
import { PencilSquareIcon } from '@heroicons/vue/20/solid'
import StandardButton from '@/components/Common/StandardButton.vue'
import { useLiveRegistrationStore } from '@/stores/liveRegistration'
import { storeToRefs } from 'pinia'

const props = defineProps({
  message: { type: Object, required: true },
  showSuccess: { type: Boolean, default: false },
  showError: { type: Boolean, default: false },
  badgeUrl: { type: String, default: '' },
  countdown: { type: [String, Number], default: '' },
  isGeneratingBadge: { type: Boolean, default: false },
  showEditButton: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'print', 'edit', 'interact'])

const liveRegistrationStore = useLiveRegistrationStore()
const { products } = storeToRefs(liveRegistrationStore)

onMounted(async () => {
  if (!products.value.length) {
    try {
      await liveRegistrationStore.fetchProducts()
    } catch (error) {
      console.error('Failed to fetch products for popup', error)
    }
  }
})

const getProductEnglishName = (product) => {
  if (!product?.name) return `Product ${product?.id || ''}`.trim()
  if (typeof product.name === 'string') return product.name
  if (typeof product.name === 'object') return product.name.en || Object.values(product.name)[0] || `Product ${product.id}`
  return `Product ${product.id}`
}

const getVariantEnglishName = (variant) => {
  if (!variant?.value) return ''
  if (typeof variant.value === 'string') return variant.value
  if (typeof variant.value === 'object') return variant.value.en || Object.values(variant.value)[0] || ''
  return ''
}

const resolvedProductName = computed(() => {
  const { product_id, variation_id, product_name_obj, variation_name_obj } = props.message
  if (!product_id) return ''

  if (product_name_obj) {
    if (variation_name_obj) {
      return getVariantEnglishName(variation_name_obj) || getProductEnglishName(product_name_obj)
    }
    return getProductEnglishName(product_name_obj)
  }

  const selectedProduct = products.value.find(p => String(p.id) === String(product_id))
  if (selectedProduct) {
    if (variation_id && selectedProduct.variations) {
      const selectedVariant = selectedProduct.variations.find(v => String(v.id) === String(variation_id))
      if (selectedVariant) {
        return getVariantEnglishName(selectedVariant) || getProductEnglishName(selectedProduct)
      }
    }
    return getProductEnglishName(selectedProduct)
  }

  return `Product ID ${product_id}`
})

const isErrorState = computed(() => props.showError)
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
    <div class="relative w-96 rounded bg-white p-5 shadow-lg" @click="emit('interact')">
      <div
        v-if="countdown"
        class="bg-gray-200 text-gray-600 absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full font-medium"
      >
        {{ countdown }}
      </div>

      <h2 :class="isErrorState ? 'text-red-600 mb-2 text-xl' : 'text-green-600 mb-2 text-xl'">
        {{ message.message }}
      </h2>

      <div v-if="isErrorState && message.errorReason" class="text-red-500 mb-4 text-base font-medium">
        {{ message.errorReason }}
      </div>

      <div v-if="!isErrorState">
        <p><b>Name:</b> {{ message.attendee_name || message.attendee }}</p>
        <p v-if="resolvedProductName"><b>Product:</b> {{ resolvedProductName }}</p>
        <p v-if="message.company"><b>Company:</b> {{ message.company }}</p>
        <p v-if="message.job_title"><b>Job Title:</b> {{ message.job_title }}</p>
      </div>

      <div class="mt-4 flex flex-col space-y-3">
        <StandardButton
          v-if="badgeUrl && showSuccess"
          type="button"
          :text="isGeneratingBadge ? 'Generating Badge...' : 'Generate Badge'"
          :disabled="isGeneratingBadge"
          class="btn-primary w-full justify-center"
          @click.stop="emit('print')"
        />

        <div class="mt-6 flex items-center gap-2">
          <button
            v-if="showEditButton && (message?.secret || message?.orderPositionId) && !isErrorState"
            type="button"
            class="inline-flex items-center rounded bg-success px-3 py-2 text-white hover:opacity-90"
            aria-label="Edit attendee details"
            @click.stop="emit('edit')"
          >
            <PencilSquareIcon class="h-5 w-5" />
          </button>
          
          <StandardButton
            type="button"
            text="Done"
            class="btn-info flex-1 justify-center"
            @click.stop="emit('close')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
