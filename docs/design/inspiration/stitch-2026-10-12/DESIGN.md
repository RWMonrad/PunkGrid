---
name: Cyber-Tactical HUD
colors:
  surface: '#111319'
  surface-dim: '#111319'
  surface-bright: '#37393f'
  surface-container-lowest: '#0c0e13'
  surface-container-low: '#191b21'
  surface-container: '#1e1f25'
  surface-container-high: '#282a30'
  surface-container-highest: '#33353a'
  on-surface: '#e2e2e9'
  on-surface-variant: '#b9cac4'
  inverse-surface: '#e2e2e9'
  inverse-on-surface: '#2e3036'
  outline: '#83948f'
  outline-variant: '#3a4a46'
  surface-tint: '#00dfc1'
  primary: '#d7fff3'
  on-primary: '#00382f'
  primary-container: '#00f5d4'
  on-primary-container: '#006c5c'
  inverse-primary: '#006b5b'
  secondary: '#ffb1c6'
  on-secondary: '#650031'
  secondary-container: '#e20476'
  on-secondary-container: '#fffbff'
  tertiary: '#fff5eb'
  on-tertiary: '#422c00'
  tertiary-container: '#ffd48b'
  on-tertiary-container: '#7e5800'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#26fedc'
  primary-fixed-dim: '#00dfc1'
  on-primary-fixed: '#00201a'
  on-primary-fixed-variant: '#005144'
  secondary-fixed: '#ffd9e1'
  secondary-fixed-dim: '#ffb1c6'
  on-secondary-fixed: '#3f001c'
  on-secondary-fixed-variant: '#8e0048'
  tertiary-fixed: '#ffdea9'
  tertiary-fixed-dim: '#ffba27'
  on-tertiary-fixed: '#271900'
  on-tertiary-fixed-variant: '#5e4100'
  background: '#111319'
  on-background: '#e2e2e9'
  surface-variant: '#33353a'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 40px
    fontWeight: '800'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-xl-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '800'
    lineHeight: 34px
    letterSpacing: -0.01em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '700'
    lineHeight: 40px
    letterSpacing: -0.015em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '700'
    lineHeight: 30px
    letterSpacing: -0.01em
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '700'
    lineHeight: 28px
  title-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  title-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 15px
    fontWeight: '600'
    lineHeight: 20px
  body-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  telemetry-lg:
    fontFamily: JetBrains Mono
    fontSize: 16px
    fontWeight: '600'
    lineHeight: 20px
    letterSpacing: 0.04em
  telemetry-md:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.03em
  telemetry-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.05em
  telemetry-micro:
    fontFamily: JetBrains Mono
    fontSize: 9px
    fontWeight: '700'
    lineHeight: 12px
    letterSpacing: 0.08em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 0.75rem
  gutter-md: 1rem
  gutter-lg: 1.5rem
  margin: 1rem
  margin-md: 1.5rem
  margin-lg: 2rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 0.75rem
  space-lg: 1.25rem
  space-xl: 2rem
---

## Brand & Style

This design system establishes a high-performance cyber-tactical interface engineered for an autonomous, continuous simulation. The aesthetic merges precision telemetry, mission-critical instrumentation, and street-level cyberpunk visual codes. 

Targeting digital natives, systems-thinkers, and simulation players, the visual language prioritizes instant situational awareness, low-latency legibility, and high-density state visualization. The interface feels active, persistent, and machine-driven, evoking the experience of commanding a live cybernetic infrastructure.

The core design style fuses **Neo-Grid Tactical** with controlled **Dark Glassmorphism**:
- Deep void surfaces with structural geometric registration marks and technical coordinates.
- Laser-sharp perimeter outlines, chamfered corner motifs, and high-frequency scanline dividers.
- Emissive telemetry beacons and status badges that pulse against low-reflectance, light-absorbing backdrops.

## Colors

The palette is tuned for high-contrast visibility against zero-lux void backdrops. Neon emissive tokens act as vital functional signifiers rather than decorative fills.

### Palette Architecture
- **Pitch Void (Neutrals)**:
  - Base Zero (`#080A0F`): Deep terminal void. Root background layer for canvas and persistent screen containers.
  - Surface Mid (`#0E121A`): Elevated tactical panels, modular tiles, and nested containers.
  - Surface High (`#141923`): Active inputs, modal dialogs, and focused card panels.
  - Border Subdued (`#1E2638`): Grid registration lines, inactive frame strokes, and cell dividers.
  - Border Tactical (`#2E3B55`): Focus framing, resting interactive borders, and technical callout lines.

- **Signal Accents**:
  - Primary Electric Cyan (`#00F5D4`): Active world states, confirmed actions, network online indicators, and high-frequency telemetry.
  - Secondary Neon Magenta (`#F72585`): Hostile alerts, critical anomalies, dynamic entity shifts, and critical priority overrides.
  - Tertiary Hazard Amber (`#FFB703`): Degraded states, energy drain, resource depletion warnings, and pending simulations.
  - Accent Electric Indigo (`#4361EE`): Compute cycles, background AI agents, data streams, and structural anchors.

- **Functional Rules**:
  - Accent colors must maintain a minimum contrast ratio of 7:1 against Base Zero for critical telemetry labels.
  - Use full saturation exclusively for active indicators, focus rings, state changes, and key numerical data points. Inactive or muted telemetry must use 40% opacity masks or shift toward `Border Tactical`.

## Typography

The typographic hierarchy enforces a strict division between human-readable editorial text and machine-generated simulation telemetry:

- **Primary Geometry (`Plus Jakarta Sans`)**: Reserved for narrative event descriptions, titles, primary navigation targets, and major system dialogues. Its geometric foundation matches technical structures while maintaining rapid human scanning.
- **Data Telemetry (`JetBrains Mono`)**: Powers all simulation parameters, world tick counters, financial balances, temporal readouts, coordinates, and status tokens. Monospaced character matrices prevent visual jitter during live numerical updates.
- **Telemetry Formatting Rule**: All monospaced metrics, micro badges, and coordinate tags must be rendered in full uppercase with positive letter tracking to maximize scan efficiency under dynamic HUD conditions.

## Layout & Spacing

The layout is built mobile-first, treating the screen as a tactile HUD console optimized for thumb-driven command input.

### Grid & Density Models
- **Mobile (< 768px)**: 4-column dynamic fluid grid. Outer margins locked to `margin` (16px), gutters to `gutter` (12px). Critical inputs and vital stat bars sit within the thumb reach zone at the screen base.
- **Tablet (768px - 1024px)**: 8-column layout. Outer margins scale to `margin-md` (24px). Telemetry panels dock to lateral split rails.
- **Desktop (> 1024px)**: 12-column fixed-max layout (1440px wide). Outer margins expand to `margin-lg` (32px), gutters scale to `gutter-lg` (24px). Left rail houses persistent agent streams; center canvas holds main viewport simulation; right rail retains contextual micro-actions.

### Space Rhythm
Spatial steps follow an intentional 4px base rhythm. Layout density remains compact (`space-sm` to `space-md` element spacing) to maximize visible data points without forcing full screen scrolls during mission-critical simulation shifts.

## Elevation & Depth

Visual hierarchy bypasses conventional drop shadows in favor of an illuminated glass-chassis hierarchy constructed from light-reactive structural planes:

1. **Layer 0 - Root Console**: Pure `#080A0F` canvas overlaid with an SVG-rendered 32px Cartesian coordinate grid at 3% opacity.
2. **Layer 1 - System Modules (Low Elevation)**: Base fill `#0E121A` at 85% opacity with an active `backdrop-filter: blur(12px)`. Enclosed by a 1px solid hairline border of `#1E2638`.
3. **Layer 2 - Floating Control Cards (Mid Elevation)**: Base fill `#141923` at 70% opacity, `backdrop-filter: blur(20px)`. Enclosed by a 1px border of `#2E3B55` featuring an internal gradient highlight at the top edge (`linear-gradient(90deg, transparent, rgba(0,245,212,0.3), transparent)`).
4. **Layer 3 - Tactical Alerts & Modals (High Elevation)**: Base fill `#141923` at 95% opacity, `backdrop-filter: blur(32px)`. Outlined with a 1px solid stroke in Primary Cyan (`#00F5D4`) or Secondary Magenta (`#F72585`), paired with an outer atmospheric neon glow: `0 0 24px rgba(0, 245, 212, 0.15), 0 8px 32px rgba(0, 0, 0, 0.8)`.

Scanline micro-textures are applied to interactive overlays via an ultra-fine repeating linear gradient (`repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0, 0, 0, 0.3) 3px)`).

## Shapes

The interface embraces a low-radius, architectural profile (`roundedness: 1` = 0.25rem / 4px base radius). This produces crisp, mechanical corners suited for tactical telemetry displays without harsh brutalist friction.

- **Base Radii**: Core inputs, utility pills, telemetry chips, and card panels adhere strictly to 4px corners (`0.25rem`).
- **Tactical Notch Pattern**: Primary control modules, alert sheets, and header blocks incorporate a 45-degree chamfered top-right corner (8px diagonal cut) achieved via clipping masks, echoing physical military HUD apertures.
- **Pill Exceptions**: True circular forms (`border-radius: 9999px`) are strictly forbidden except for live connectivity pings and agent presence nodes.

## Components

### Buttons
- **Primary Cyber Button**: Background in solid Electric Cyan (`#00F5D4`), text in Base Zero (`#080A0F`), font `JetBrains Mono` bold uppercase. Chamfered top-right corner. Hover state introduces an outer glow `0 0 16px rgba(0, 245, 212, 0.6)`. Active state shifts to a 1px inset border with 10% brightness reduction.
- **Secondary Outlined Button**: Transparent backdrop, 1px border `#2E3B55`, text `#00F5D4`. Hover transitions border to `#00F5D4` and background to `rgba(0, 245, 212, 0.08)`.
- **Destructive/Critical Button**: 1px border in Neon Magenta (`#F72585`), text `#F72585`, background `rgba(247, 37, 133, 0.05)`. Hover introduces `0 0 16px rgba(247, 37, 133, 0.4)`.

### Chips & Telemetry Badges
- Compact height (20px to 24px), font `telemetry-micro`, tracking `0.08em`.
- Structure: Hairline border (1px), subtle tonal fill (8% opacity), and a leading 4px square status beacon (pulsing for live ticks, static for static metadata).
- Variant mappings: Normal (`#00F5D4`), Warning (`#FFB703`), Fatal (`#F72585`), Neutral (`#4361EE`).

### Input Fields
- Dark translucent background `#0E121A` (90% opacity), bottom border 2px solid `#2E3B55`, lateral and top borders 1px solid `#1E2638`.
- Focus state activates an instantaneous transition of the bottom border to `#00F5D4` with an ambient cyan underglow `0 4px 12px rgba(0, 245, 212, 0.2)`. Placeholder text formatted in `JetBrains Mono` at 40% opacity.

### Checkboxes & Radios
- Sharp 2px rounded boxes (16x16px). Unselected: 1px border `#2E3B55`, empty void core.
- Selected: Border `#00F5D4`, solid `#00F5D4` interior dot/check with an internal glow.
- Radio buttons feature a concentric rotated diamond or square layout instead of standard rounded circles.

### Cards & Telemetry Tiles
- Backed by low-reflectance glass `#0E121A` (85% fill, blur 16px), bordered in `#1E2638`.
- Top-left corner features micro-coordinate labeling (e.g., `SEC//09.A`) in `telemetry-micro` text.
- Top edge contains a high-precision 1px accent stroke running across 30% of the card's width.

### Domain-Specific Components
- **World Tick Ticker**: Floating sticky telemetry bar tracking current epoch, cycle duration, and compute latency with an active heartbeat waveform.
- **Stat Readout Gauge**: Segmented linear progress meters composed of discrete micro-bars with reactive color stepping: green/cyan (>50%), amber (20-50%), magenta (<20%).
- **Terminal Event Feed**: Monospaced timestamped log stream with distinct color-coded event hashes, variable font weighting, and subtle scanline row alternating backgrounds.