/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      // The app's only neutral family (confirmed: no gray-*/stone-*/zinc-*/
      // neutral-* usage anywhere) is remapped to CSS custom properties instead
      // of Tailwind's own literal hex scale. This is what makes the tenant
      // theme system (docs/adr/0042-tenant-theme-system.md) work without
      // touching any of the ~49 files that already use slate-* classes: the
      // values these compile to are now runtime-switchable via the
      // `[data-theme]` attribute in index.css, not fixed at build time.
      colors: {
        slate: {
          50: 'var(--n-50)',
          100: 'var(--n-100)',
          200: 'var(--n-200)',
          300: 'var(--n-300)',
          400: 'var(--n-400)',
          500: 'var(--n-500)',
          600: 'var(--n-600)',
          700: 'var(--n-700)',
          800: 'var(--n-800)',
          900: 'var(--n-900)',
          950: 'var(--n-950)',
        },
      },
    },
  },
  plugins: [],
};
