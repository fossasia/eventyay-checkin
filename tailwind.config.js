/** @type {import('tailwindcss').Config} */

import tailwindForms from '@tailwindcss/forms'

export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    fontFamily: {
      sans: ['var(--font-sans)'],
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
    },
    extend: {
      colors: {
        body: {
          DEFAULT: '#222222',
          muted: '#767676',
          light: 'rgba(0,0,0,0.6)'
        },
        surface: {
          DEFAULT: '#ffffff',
          muted: '#f8f9fa',
          border: '#e9ecef'
        },
        primary: {
          light: '#5f9cd4',
          DEFAULT: '#2185d0',
          dark: '#1a69a4'
        },
        secondary: {
          light: '#e9ecef',
          DEFAULT: '#6c757d',
          dark: '#495057'
        },
        success: {
          light: '#7bc492',
          DEFAULT: '#50a167',
          dark: '#3d7d50'
        },
        danger: {
          light: '#f5c6cb',
          DEFAULT: '#db2828',
          dark: '#b21f2d'
        },
        warning: {
          light: '#ffe8a1',
          DEFAULT: '#ffb419',
          dark: '#cc9014'
        },
        info: {
          light: '#9ec5e8',
          DEFAULT: '#5f9cd4',
          dark: '#4697c9'
        }
      },
      boxShadow: {
        card: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06)',
        'card-hover': '0 4px 12px rgba(0,0,0,0.1)'
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem'
      }
    }
  },
  plugins: [tailwindForms]
}
