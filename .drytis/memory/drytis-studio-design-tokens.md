# Drytis Studio (studio.drytis.ai) design tokens — extracted 2025 via curl

Source: Next.js SPA, shadcn/ui + Tailwind v4. CSS bundles:
- `/_next/static/chunks/0jx8j9jk46k95.css` (329KB, main)
- `/_next/static/chunks/42ew2xsbedwtb.css` (font-faces)
- `/_next/static/chunks/41tuk253_yqyv.css` (driver.js tour, 3rd-party)

## Core tokens (light `:root`, the default)
- --radius:.625rem (10px); scale: xs 2px / md 8px / lg 10px / xl 14px / 2xl 16px / 3xl 24px
- --spacing:.25rem
- --background:#fff --foreground:#0a0a0a --card:#fff --popover:#fff
- --primary:#171717 (fg #fafafa) — near-black buttons, NOT blue
- --secondary/--muted:#f5f5f5 --muted-foreground:#737373
- --border/--input:#e5e5e5 --ring:#a1a1a1 --destructive:#e40014
- --sidebar:#fafafa --sidebar-border:#e5e5e5
- theme layer: --theme-border:#e5e7eb --theme-border-light:#d1d5db --theme-bg:#fff
  --theme-bg-secondary:#f9fafb --theme-bg-tertiary:#f3f4f6
  --theme-text:#111827 --theme-text-secondary:#374151 --theme-text-muted:#6b7280
- sp panel tokens (light): --sp-bg:#f8f9fb --sp-bg-card:#fff --sp-border:#e5e7eb
- rib pill: bg #dbeafe, shadow 0 8px 32px #2563eb26, text #1e40af
- tour accent #2563eb, soft #2563eb17, ring #2563eb59

## Dark (.dark)
- --background/--card/--popover:#1a1a1a --foreground:#fafafa
- --primary:#e5e5e5 (inverted) --secondary/--muted:#252525 --muted-foreground:#a1a1a1
- --border/--input:#3f3f46 --ring:#737373 --destructive:#ff6568
- --sidebar-primary:#1447e6 (blue in dark)
- theme: bg #1a1a1a / #27272a / #3f3f46; text #fafafa/#e4e4e7/#a1a1aa
- sp: --sp-bg:#0e1015 --sp-bg-card:#171a21 --sp-border:#23272f --sp-text-dim:#4b5563

## Brand accent (most-used hex, 15×)
- **#2F5BEA** (brand blue), sibling **#1E56F5**
- glow shadow: 0 6px 18px/20px rgba(47,91,234,.35) (#2f5bea59)
- focus rings: #2f5bea26 (/15), #3b82f680, 0 0 0 8px #3b82f633
- deep navy ink: #0F1729 (bg/text/border, also /0.18 alpha)

## Fonts (next/font self-hosted woff2, variable 100-900)
- --font-geist-sans:"Geist" = PRIMARY UI font (used !important as base)
- --font-geist-mono:"Geist Mono" = primary mono
- also loaded: Instrument Sans, JetBrains Mono, Space Grotesk, IBM Plex Mono
- fallback: ui-sans-serif,system-ui,sans-serif / ui-monospace,SFMono-Regular,Menlo,Consolas
- body antialiased; sizes: xs .75rem sm .875rem base 1rem lg 1.125rem xl 1.25rem 2xl 1.5rem; UI mostly text-sm

## Structure
- Sidebar widths 224/240/256px (calc(spacing*56/60/64)); controls h 32-44px; inputs 48px
- Cards: #fff + #e5e5e5 border + 10px radius + shadow-sm (Tailwind defaults sm/md/lg/xl/2xl)
- Status badges: alpha pattern — bg tint 8-20%, border saturate 15-30% (green-500/15..30, amber-500/20..70, blue-500/15..70, destructive/30..50)
- Inputs [data-slot=input-group]: light #f9fafb bg + #d1d5dc border; dark #252525 + zinc-700; "AI active" variant has animated conic-gradient border (#7dd3fc,#38bdf8,#0ea5e9)
- shadcn data-slot attributes: card, button-group, input-group, select-trigger, badge, avatar, table, command-*
- Shell: html 100dvh overflow hidden; toasts fixed top-5 right-5
- Status palette from JS: green #16a34a/#15803d/#22c55e, red #e11d48/#be123c, yellow #fde047, amber #f6ac2f
