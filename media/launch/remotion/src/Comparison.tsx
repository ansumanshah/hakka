import { loadFont } from '@remotion/fonts'
import { Video } from '@remotion/media'
import {
  AbsoluteFill,
  Img,
  Sequence,
  interpolate,
  interpolateColors,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

loadFont({ family: 'Geist', url: staticFile('fonts/Geist-Variable.woff2'), weight: '100 900' })
loadFont({ family: 'Geist Mono', url: staticFile('fonts/GeistMono-Variable.woff2'), weight: '100 900' })

const progress = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })

// Remotion trim props use composition-frame units. The source recording is VFR,
// so keep the timeline anchored to source timestamps at the 30 fps composition rate.
const sourceFrame = (seconds: number) => Math.round(seconds * 30)

const cues = [
  { from: 0, to: 84, lead: 'A request ', accent: 'fails.', color: '#ef745e' },
  { from: 84, to: 192, lead: 'Hakka catches ', accent: 'the 404.', color: '#ee8320' },
  { from: 192, to: 330, lead: 'Open the ', accent: 'request.', color: '#ee8320' },
  { from: 330, to: 450, lead: 'Read the ', accent: 'response.', color: '#ee8320' },
]

const MobileClip = ({
  from,
  durationInFrames,
  trimBefore,
  trimAfter,
  offsetY,
}: {
  from: number
  durationInFrames: number
  trimBefore: number
  trimAfter: number
  offsetY: number
}) => (
  <Sequence from={from} durationInFrames={durationInFrames} premountFor={15}>
    <Video
      src={staticFile('mobile-ios-demo.mp4')}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      muted
      style={{
        display: 'block',
        width: 940,
        height: 2044,
        transform: `translateY(${offsetY}px)`,
        filter: offsetY ? 'brightness(1.18)' : undefined,
      }}
    />
  </Sequence>
)

const Wordmark = ({ compact = false }: { compact?: boolean }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: compact ? 9 : 13,
      color: '#f2eee8',
      fontSize: compact ? 32 : 44,
      fontWeight: 720,
      letterSpacing: compact ? -1.5 : -2.2,
    }}
  >
    <span style={{ color: '#ee8320', fontSize: compact ? 35 : 48 }}>•</span>
    hakka
  </div>
)

const KineticCue = ({ from, to, lead, accent, color }: (typeof cues)[number]) => {
  const frame = useCurrentFrame()
  const entering = progress(frame, from, from + 9)
  const leaving = progress(frame, to - 9, to)
  const weight = progress(frame, from + 12, from + 36)
  const opacity = frame >= from && frame < to ? Math.min(entering, 1 - leaving) : 0

  return (
    <div
      style={{
        position: 'absolute',
        top: 142,
        left: 64,
        right: 64,
        zIndex: 10,
        fontSize: 76,
        lineHeight: 1,
        letterSpacing: -4,
        opacity,
        transform: `translateY(${(1 - entering) * 24 - leaving * 14}px)`,
      }}
    >
      <span>{lead}</span>
      <span
        style={{
          color: interpolateColors(weight, [0, 1], ['#f2eee8', color]),
          fontVariationSettings: `'wght' ${450 + 250 * weight}`,
        }}
      >
        {accent}
      </span>
    </div>
  )
}

const EndCard = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const reveal = spring({ frame, fps, config: { damping: 22, stiffness: 90 } })
  const accentProgress = progress(frame, 20, 48)

  return (
    <AbsoluteFill
      style={{
        background: '#111110',
        color: '#f2eee8',
        padding: '150px 64px 88px',
        opacity: reveal,
        transform: `translateY(${(1 - reveal) * 32}px)`,
        justifyContent: 'space-between',
      }}
    >
      <div>
        <Wordmark />
        <div style={{ marginTop: 150, fontSize: 92, fontWeight: 520, lineHeight: 0.98, letterSpacing: -5 }}>
          <div>Debug what</div>
          <div>
            your app{' '}
            <span
              style={{
                color: interpolateColors(accentProgress, [0, 1], ['#f2eee8', '#ee8320']),
                fontVariationSettings: `'wght' ${450 + 260 * accentProgress}`,
              }}
            >
              actually
            </span>
          </div>
          <div>sent.</div>
        </div>
      </div>
      <div>
        <div style={{ color: '#b8b4ad', fontFamily: 'Geist Mono', fontSize: 34, letterSpacing: 1.1 }}>
          NATIVE NETWORK INSPECTION, ON DEVICE.
        </div>
        <div style={{ marginTop: 34, color: '#ee8320', fontFamily: 'Geist Mono', fontSize: 36, letterSpacing: 0.3 }}>
          github.com/ansumanshah/hakka
        </div>
      </div>
    </AbsoluteFill>
  )
}

export const Comparison = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const phoneIn = spring({ frame: Math.max(0, frame - 3), fps, config: { damping: 22, stiffness: 110 } })
  const cardExit = progress(frame, 444, 474)

  return (
    <AbsoluteFill style={{ background: '#111110', color: '#f2eee8', fontFamily: 'Geist' }}>
      <div style={{ position: 'absolute', top: 48, left: 64, zIndex: 10 }}>
        <Wordmark compact />
      </div>
      <div
        style={{
          position: 'absolute',
          top: 57,
          right: 64,
          zIndex: 10,
          color: '#b8b4ad',
          fontFamily: 'Geist Mono',
          fontSize: 14,
          letterSpacing: 1,
        }}
      >
        REAL IOS CAPTURE
      </div>

      {cues.map((cue) => (
        <KineticCue key={cue.from} {...cue} />
      ))}

      <div
        style={{
          position: 'absolute',
          top: 236,
          left: 70,
          width: 940,
          height: 1650,
          overflow: 'hidden',
          border: '1px solid #4a443e',
          borderRadius: 24,
          boxShadow: '0 28px 90px #0009',
          opacity: 0.98 * (1 - cardExit),
          transform: `translateY(${(1 - phoneIn) * 48 - cardExit * 26}px) scale(${0.985 + phoneIn * 0.015})`,
          transformOrigin: 'top center',
        }}
      >
        <MobileClip
          from={0}
          durationInFrames={84}
          trimBefore={sourceFrame(20.5)}
          trimAfter={sourceFrame(23.3)}
          offsetY={0}
        />
        <MobileClip
          from={84}
          durationInFrames={108}
          trimBefore={sourceFrame(59)}
          trimAfter={sourceFrame(62.6)}
          offsetY={-340}
        />
        <MobileClip
          from={192}
          durationInFrames={138}
          trimBefore={sourceFrame(68)}
          trimAfter={sourceFrame(72.6)}
          offsetY={-340}
        />
        <MobileClip
          from={330}
          durationInFrames={60}
          trimBefore={sourceFrame(77.5)}
          trimAfter={sourceFrame(79.5)}
          offsetY={-340}
        />
        <Sequence from={390} durationInFrames={84}>
          <Img
            src={staticFile('mobile-ios-response.png')}
            style={{
              display: 'block',
              width: 940,
              height: 2044,
              transform: 'translateY(-340px)',
              filter: 'brightness(1.18)',
            }}
          />
        </Sequence>
      </div>

      <Sequence from={474} durationInFrames={156}>
        <EndCard />
      </Sequence>
    </AbsoluteFill>
  )
}
