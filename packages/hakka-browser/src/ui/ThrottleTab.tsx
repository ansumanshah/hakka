/**
 * ThrottleTab — network-conditions (throttle) control panel. Lets the user
 * pick a throttle profile (none, fast-3g, slow-3g, edge, offline) and shows
 * the current effective config in a KV table; subscribes to
 * ThrottleEngine.onChange so the UI stays in sync with profile changes made
 * elsewhere.
 */

import { ThrottleEngine } from 'hakka-core'
import type { ThrottleConfig, ThrottleProfile } from 'hakka-core'
import type { Component } from 'solid-js'
import { createSignal, For, onSettled } from 'solid-js'

import type { PanelProps } from './panelRegistry'

interface ProfileMeta {
  profile: Exclude<ThrottleProfile, 'custom'>
  label: string
}

const PROFILES: ProfileMeta[] = [
  { profile: 'none', label: 'None' },
  { profile: 'fast-3g', label: 'Fast 3G' },
  { profile: 'slow-3g', label: 'Slow 3G' },
  { profile: 'edge', label: 'Edge' },
  { profile: 'offline', label: 'Offline' },
]

function profileLabel(profile: ThrottleProfile): string {
  switch (profile) {
    case 'none':
      return 'None'
    case 'fast-3g':
      return 'Fast 3G'
    case 'slow-3g':
      return 'Slow 3G'
    case 'edge':
      return 'Edge'
    case 'offline':
      return 'Offline'
    case 'custom':
      return 'Custom'
  }
}

export const ThrottleTab: Component<PanelProps> = () => {
  // Seed from current state; onChange does NOT fire immediately on subscribe.
  const [config, setConfig] = createSignal<ThrottleConfig>(ThrottleEngine.current)

  onSettled(() => {
    const off = ThrottleEngine.onChange((cfg) => setConfig(cfg))
    // onChange does not fire immediately on subscribe — resync in case the
    // profile changed between first render and settle.
    setConfig(ThrottleEngine.current)
    return off
  })

  function handleProfileClick(profile: ThrottleProfile): void {
    ThrottleEngine.setProfile(profile)
  }

  // var(--hakka-status-on) is the text-on-solid-status token (same idiom as
  // .hakka-badge/.hakka-row-checkbox in styles.ts) — status-error isn't
  // re-themed for light mode, so literal white stays correct in both themes.
  const offlineBadge =
    'display:inline-block;font-size:var(--hakka-font-xs);font-weight:700;' +
    'color:var(--hakka-status-on);background:var(--hakka-status-error);border-radius:var(--hakka-radius-sm);padding:1px var(--hakka-space-sm)'

  return (
    <div class="hakka-pane">
      {/* No tab-level title/desc — the tab strip is the title (DESIGN.md
          "Panel section anatomy"); Throttle has no natural empty state (a
          profile is always active), so the framing lives in the section
          title below plus each chip's own label. */}

      <div class="hakka-section-title">Profile</div>
      <div style="display:flex;flex-wrap:wrap;gap:var(--hakka-space-sm);margin-bottom:var(--hakka-space-xl)">
        <For each={PROFILES}>
          {(meta) => (
            <button
              class={`hakka-chip${config().profile === meta.profile ? ' active' : ''}`}
              aria-pressed={config().profile === meta.profile ? 'true' : 'false'}
              onClick={() => handleProfileClick(meta.profile)}
            >
              {meta.label}
            </button>
          )}
        </For>
      </div>

      <div class="hakka-section-title">Current conditions</div>
      <table class="hakka-kv-table" style="margin-bottom:var(--hakka-space-xl)">
        <tbody>
          <tr>
            <td class="hakka-kv-key">Profile</td>
            <td class="hakka-kv-value">{profileLabel(config().profile)}</td>
          </tr>
          <tr>
            <td class="hakka-kv-key">Latency</td>
            <td class="hakka-kv-value">{config().latencyMs ?? 0} ms</td>
          </tr>
          <tr>
            <td class="hakka-kv-key">Download</td>
            <td class="hakka-kv-value">{(config().downloadKbps ?? 0) > 0 ? `${config().downloadKbps} kbps` : '—'}</td>
          </tr>
          {ThrottleEngine.isOffline && (
            <tr>
              <td class="hakka-kv-key">Status</td>
              <td class="hakka-kv-value">
                <span style={offlineBadge}>OFFLINE</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div class="hakka-hint hakka-hint-em" style="margin-top:var(--hakka-space-xl);line-height:1.5">
        Throttling adds artificial latency and bandwidth limits to fetch/XHR on the main thread, simulating slow network
        conditions — a feature no comparable web inspector ships.
      </div>
    </div>
  )
}
