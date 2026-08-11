<script setup>
import { computed, ref, watch } from 'vue'
import StandardButton from '@/components/Common/StandardButton.vue'

const props = defineProps({
  fields: {
    type: Array,
    default: () => []
  },
  hiddenFields: {
    type: Array,
    default: () => []
  },
  fieldOverrides: {
    type: Object,
    default: () => ({})
  },
  allowBadgeEditing: {
    type: Boolean,
    default: false
  },
  showPreview: {
    type: Boolean,
    default: true
  },
  mode: {
    type: String,
    default: 'print',
    validator: (value) => ['print', 'edit'].includes(value)
  },
  layouts: {
    type: Array,
    default: () => []
  },
  initialLayoutId: {
    type: [Number, String],
    default: null
  }
})

const emit = defineEmits(['confirm', 'cancel', 'preview'])

const selectedHidden = ref([...props.hiddenFields])
const fieldValues = ref({})
const selectedLayoutId = ref(
  props.initialLayoutId != null && props.initialLayoutId !== ''
    ? String(props.initialLayoutId)
    : ''
)

function buildFieldValues(sourceFields, overrides) {
  const values = {}
  for (const field of sourceFields) {
    const key = String(field.key || '')
    if (!key) {
      continue
    }
    values[key] = String(overrides?.[key] ?? field.value ?? '')
  }
  return values
}

watch(
  () => [props.fields, props.hiddenFields, props.fieldOverrides],
  () => {
    selectedHidden.value = [...(props.hiddenFields || [])]
    fieldValues.value = buildFieldValues(props.fields, props.fieldOverrides)
  },
  { immediate: true, deep: true }
)

watch(
  () => [props.initialLayoutId, props.layouts],
  () => {
    if (props.initialLayoutId != null && props.initialLayoutId !== '') {
      selectedLayoutId.value = String(props.initialLayoutId)
      return
    }
    const defaultLayout = (props.layouts || []).find((layout) => layout.default)
    if (defaultLayout) {
      selectedLayoutId.value = String(defaultLayout.id)
    } else if (props.layouts?.length) {
      selectedLayoutId.value = String(props.layouts[0].id)
    } else {
      selectedLayoutId.value = ''
    }
  },
  { immediate: true }
)

const isEditMode = computed(() => props.mode === 'edit')

const showLayoutSelect = computed(
  () => !isEditMode.value && Array.isArray(props.layouts) && props.layouts.length > 0
)

const hasFieldCustomization = computed(() => props.fields.length > 0)

const headingText = computed(() => {
  if (isEditMode.value) {
    return 'Edit badge'
  }
  if (hasFieldCustomization.value) {
    return 'Customize your badge before printing'
  }
  return 'Print badge'
})

const helperText = computed(() => {
  if (isEditMode.value) {
    if (props.allowBadgeEditing) {
      return 'Choose which fields to show on the badge and edit the printed text.'
    }
    return 'Uncheck fields if you want to hide them on the badge.'
  }
  if (showLayoutSelect.value && hasFieldCustomization.value) {
    if (props.allowBadgeEditing) {
      return 'Choose a badge layout, then select fields and edit the printed text.'
    }
    return 'Choose a badge layout, then uncheck fields you want to hide on the printed badge.'
  }
  if (showLayoutSelect.value) {
    return 'Choose which badge layout to print for this attendee.'
  }
  if (props.allowBadgeEditing) {
    return 'Choose which fields to show and edit the text that will appear on the printed badge.'
  }
  return 'Uncheck fields if you want to hide them on the printed badge.'
})

const confirmButtonText = computed(() => (isEditMode.value ? 'Save badge' : 'Continue to print'))

const visibleFields = computed(() =>
  props.fields.filter((field) => !selectedHidden.value.includes(field.key))
)

const canContinue = computed(() => {
  if (hasFieldCustomization.value && visibleFields.value.length === 0) {
    return false
  }
  if (showLayoutSelect.value && !selectedLayoutId.value) {
    return false
  }
  return true
})

function toggleField(key) {
  if (selectedHidden.value.includes(key)) {
    selectedHidden.value = selectedHidden.value.filter((item) => item !== key)
  } else {
    selectedHidden.value = [...selectedHidden.value, key]
  }
}

function buildCustomizationResult() {
  const layoutId = selectedLayoutId.value ? Number(selectedLayoutId.value) : null
  const hiddenFields = [...selectedHidden.value]
  if (!props.allowBadgeEditing) {
    return { hiddenFields, layoutId }
  }

  const fieldOverrides = {}
  for (const field of visibleFields.value) {
    const key = String(field.key || '')
    if (!key) {
      continue
    }
    const value = String(fieldValues.value[key] || '').trim()
    const original = String(field.value || '').trim()
    if (value && value !== original) {
      fieldOverrides[key] = value
    }
  }

  return { hiddenFields, fieldOverrides, layoutId }
}

function handleConfirm() {
  emit('confirm', buildCustomizationResult())
}

function handlePreview() {
  emit('preview', buildCustomizationResult())
}

function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div class="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
    <div class="card w-full max-w-md p-6">
      <h2 class="text-xl font-semibold text-body">{{ headingText }}</h2>
      <p class="mt-2 text-sm text-body-muted">
        {{ helperText }}
      </p>

      <div v-if="showLayoutSelect" class="mt-4">
        <label for="badge-layout-select" class="text-sm font-medium text-body">Badge layout</label>
        <select
          id="badge-layout-select"
          v-model="selectedLayoutId"
          class="mt-1 w-full"
          aria-label="Badge layout"
        >
          <option
            v-for="layout in layouts"
            :key="layout.id"
            :value="String(layout.id)"
          >
            {{ layout.name }}{{ layout.default ? ' (default)' : '' }}
          </option>
        </select>
      </div>

      <ul v-if="hasFieldCustomization" class="mt-4 space-y-3">
        <li v-for="field in fields" :key="field.key" class="space-y-2">
          <label class="flex items-center gap-3 text-sm text-body">
            <input
              type="checkbox"
              class="h-4 w-4 rounded border-surface-border text-primary focus:ring-primary/30"
              :checked="!selectedHidden.includes(field.key)"
              @change="toggleField(field.key)"
            />
            <span>{{ field.label }}</span>
          </label>
          <input
            v-if="allowBadgeEditing && !selectedHidden.includes(field.key)"
            v-model="fieldValues[field.key]"
            type="text"
            class="w-full"
            :aria-label="`Edit badge field: ${field.label}`"
          />
        </li>
      </ul>

      <p
        v-if="hasFieldCustomization && visibleFields.length === 0"
        class="mt-4 text-sm text-warning-dark"
      >
        At least one field should remain visible on the badge.
      </p>

      <div class="mt-6 space-y-2">
        <StandardButton
          v-if="showPreview"
          type="button"
          text="Preview badge"
          variant="white"
          block
          :disabled="!canContinue"
          @click="handlePreview"
        />
        <StandardButton
          type="button"
          :text="confirmButtonText"
          variant="primary"
          block
          :disabled="!canContinue"
          @click="handleConfirm"
        />
        <StandardButton type="button" text="Cancel" variant="white" block @click="handleCancel" />
      </div>
    </div>
  </div>
</template>
