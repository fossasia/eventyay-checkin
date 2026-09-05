<script setup>
import { computed, useAttrs } from 'vue'

const props = defineProps({
  type: {
    type: String,
    default: 'button'
  },
  text: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  icon: {
    type: Function,
    default: null
  },
  iconAfter: {
    type: Function,
    default: null
  },
  variant: {
    type: String,
    default: 'primary',
    validator: (value) =>
      ['primary', 'secondary', 'success', 'danger', 'warning', 'info', 'white', 'ghost'].includes(value)
  },
  size: {
    type: String,
    default: 'md',
    validator: (value) => ['sm', 'md', 'lg'].includes(value)
  },
  block: {
    type: Boolean,
    default: false
  }
})

defineOptions({
  inheritAttrs: false
})

const attrs = useAttrs()

const variantClass = computed(() => {
  const variants = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    success: 'btn-success',
    danger: 'btn-danger',
    warning: 'btn-warning',
    info: 'btn-info',
    white: 'btn-white',
    ghost: 'btn-ghost'
  }
  return variants[props.variant] || variants.primary
})

const sizeClass = computed(() => {
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-base'
  }
  return sizes[props.size] || sizes.md
})
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="inline-flex items-center justify-center gap-2 rounded-xl font-semibold shadow-sm transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:opacity-60"
    :class="[variantClass, sizeClass, block ? 'w-full' : '']"
    v-bind="attrs"
  >
    <component :is="icon" v-if="icon" class="h-5 w-5 shrink-0" />
    <span v-if="text">{{ text }}</span>
    <component :is="iconAfter" v-if="iconAfter" class="h-5 w-5 shrink-0" />
  </button>
</template>
