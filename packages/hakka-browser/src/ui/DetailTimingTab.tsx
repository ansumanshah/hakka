import type { NetworkRequest } from 'hakka-core'
import type { Component } from 'solid-js'
import { Show } from 'solid-js'

function timingMs(n: number | undefined): string {
  if (n == null) return '—'
  return `${n.toFixed(1)} ms`
}

interface TimingBarProps {
  label: string
  value: number | undefined
  total: number
  color: string
  /** Zero-based index for staggered grow animation (index * 40ms delay). */
  index?: number
}

const TimingBar: Component<TimingBarProps> = (props) => {
  const pct = () => {
    if (!props.value || !props.total) return 0
    return Math.min(100, (props.value / props.total) * 100)
  }

  const delay = () => `${(props.index ?? 0) * 40}ms`

  return (
    <div class="hakka-timing-row">
      <span class="hakka-timing-label">{props.label}</span>
      <div class="hakka-timing-track">
        <div
          class="hakka-timing-bar"
          style={{
            width: `${pct()}%`,
            background: props.color,
            // Grow via transform:scaleX — compositor-only, 60fps safe
            'transform-origin': 'left center',
            animation: `hakka-bar-grow 400ms cubic-bezier(0.22,1,0.36,1) ${delay()} both`,
          }}
        />
      </div>
      <span class="hakka-timing-value">{timingMs(props.value)}</span>
    </div>
  )
}

interface DetailTimingTabProps {
  req: NetworkRequest
}

export const DetailTimingTab: Component<DetailTimingTabProps> = (props) => {
  const totalTiming = () => {
    const t = props.req.timing
    if (!t) return props.req.duration ?? 0
    return (t.dnsMs ?? 0) + (t.connectMs ?? 0) + (t.tlsMs ?? 0) + (t.ttfbMs ?? 0) + (t.downloadMs ?? 0)
  }

  const hasTiming = () => {
    const t = props.req.timing
    return t && (t.dnsMs != null || t.connectMs != null || t.tlsMs != null || t.ttfbMs != null || t.downloadMs != null)
  }

  return (
    <Show
      when={hasTiming()}
      fallback={
        <Show
          when={props.req.duration != null}
          fallback={
            <p class="hakka-timing-note">Timing unavailable — add Timing-Allow-Origin for cross-origin requests.</p>
          }
        >
          <div class="hakka-timing">
            <div class="hakka-timing-row">
              <span class="hakka-timing-label">Total</span>
              <div class="hakka-timing-track">
                <div class="hakka-timing-bar" style={{ width: '100%', background: 'var(--hakka-timing-ttfb)' }} />
              </div>
              <span class="hakka-timing-value">{timingMs(props.req.duration ?? undefined)}</span>
            </div>
          </div>
        </Show>
      }
    >
      <div class="hakka-timing">
        {/* Connection phases absent while TTFB exists = the socket was
            reused (keep-alive) or the layer can't split them (undici
            exposes connect only; browsers gate phases behind
            Timing-Allow-Origin). Say so explicitly instead of leaving
            three bare dashes that read as a bug. */}
        <Show
          when={
            props.req.timing?.ttfbMs != null &&
            props.req.timing?.dnsMs == null &&
            props.req.timing?.connectMs == null &&
            props.req.timing?.tlsMs == null
          }
        >
          <p class="hakka-timing-note">Connection reused or phases not measurable at this layer</p>
        </Show>
        <TimingBar
          label="DNS"
          value={props.req.timing?.dnsMs}
          total={totalTiming()}
          color="var(--hakka-timing-dns)"
          index={0}
        />
        <TimingBar
          label="TCP"
          value={props.req.timing?.connectMs}
          total={totalTiming()}
          color="var(--hakka-timing-tcp)"
          index={1}
        />
        <TimingBar
          label="TLS"
          value={props.req.timing?.tlsMs}
          total={totalTiming()}
          color="var(--hakka-timing-tls)"
          index={2}
        />
        <TimingBar
          label="TTFB"
          value={props.req.timing?.ttfbMs}
          total={totalTiming()}
          color="var(--hakka-timing-ttfb)"
          index={3}
        />
        <TimingBar
          label="Download"
          value={props.req.timing?.downloadMs}
          total={totalTiming()}
          color="var(--hakka-timing-download)"
          index={4}
        />
      </div>
    </Show>
  )
}
