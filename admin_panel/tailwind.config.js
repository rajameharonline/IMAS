/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      // ── Typography (standing rule) ──────────────────────────
      // Sans-serif: body, labels, buttons (Inter)
      // Monospace : MAC, IP, ONU ID, RX power (JetBrains Mono)
      // Slab-serif: headers, page titles (Roboto Slab)
      fontFamily: {
        sans:  ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono:  ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'Consolas', 'monospace'],
        slab:  ['"Roboto Slab"', '"Zilla Slab"', 'Bitter', 'serif'],
      },
      colors: {
        // ── TopBar/Sidebar reference tokens (primary, app-wide consistency) ──
        // এগুলো production TopBar/Sidebar-এ ইতিমধ্যে আছে — নতুন কাজে যেখানে
        // dark anchor বা border on dark দরকার সেখানে এই tokens use করা।
        topbar: {
          DEFAULT: '#1c2333',  // TopBar bg — section header, table header
          mid:     '#2a3347',  // TopBar inner border, inputs on dark
        },
        primary: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe',
          300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6',
          600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a',
        },
        sidebar: {
          900: '#0f172a',
          800: '#1e293b',
          700: '#293548',
          600: '#334155',
          400: '#94a3b8',
          300: '#cbd5e1',
        },
      },
      keyframes: {
        fadeSlideDown: {
          '0%':   { opacity: '0', transform: 'translateY(-6px) scale(0.97)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        fromDots: {
          '0%':   { opacity: '0', transform: 'translateX(60%) scale(0.75)' },
          '65%':  { opacity: '1', transform: 'translateX(-3px) scale(1.03)' },
          '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
        },
      },
      animation: {
        fadeSlideDown: 'fadeSlideDown 0.15s ease-out',
        fromDots: 'fromDots 0.22s cubic-bezier(0.34,1.56,0.64,1)',
      },
    },
  },
  plugins: [],
}
