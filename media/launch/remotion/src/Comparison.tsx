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
  { from: 0, to: 60, lead: 'Something ', accent: 'failed.', color: '#ef745e' },
  { from: 60, to: 135, lead: 'Caught ', accent: 'on device.', color: '#ee8320' },
  { from: 135, to: 240, lead: 'Open the ', accent: 'request.', color: '#ee8320' },
  { from: 240, to: 300, lead: 'Read the ', accent: 'response.', color: '#ee8320' },
  { from: 300, to: 360, lead: 'Debug ', accent: 'on device.', color: '#ee8320' },
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

export const Comparison = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const phoneIn = spring({ frame: Math.max(0, frame - 3), fps, config: { damping: 22, stiffness: 110 } })

  return (
    <AbsoluteFill style={{ background: '#111110', color: '#f2eee8', fontFamily: 'Geist' }}>
      <div
        style={{
          position: 'absolute',
          top: 48,
          left: 64,
          zIndex: 10,
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: -1.5,
        }}
      >
        <span style={{ color: '#ee8320', marginRight: 9 }}>•</span>hakka
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
        NATIVE IOS / REAL CAPTURE
      </div>

      {cues.map(({ from, to, lead, accent, color }) => {
        const entering = progress(frame, from, from + 6)
        const weight = progress(frame, from + 10, from + 34)
        return (
          <div
            key={from}
            style={{
              position: 'absolute',
              top: 139,
              left: 64,
              right: 64,
              zIndex: 10,
              fontSize: 76,
              lineHeight: 1,
              letterSpacing: -4,
              opacity: frame >= from && frame < to ? entering : 0,
              transform: `translateY(${(1 - entering) * 24}px)`,
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
      })}

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
          opacity: 0.98,
          transform: `translateY(${(1 - phoneIn) * 48}px) scale(${0.985 + phoneIn * 0.015})`,
          transformOrigin: 'top center',
        }}
      >
        <MobileClip
          from={0}
          durationInFrames={60}
          trimBefore={sourceFrame(20.5)}
          trimAfter={sourceFrame(22.5)}
          offsetY={0}
        />
        <MobileClip
          from={60}
          durationInFrames={75}
          trimBefore={sourceFrame(59)}
          trimAfter={sourceFrame(61.5)}
          offsetY={-340}
        />
        <MobileClip
          from={135}
          durationInFrames={105}
          trimBefore={sourceFrame(68)}
          trimAfter={sourceFrame(71.5)}
          offsetY={-340}
        />
        <MobileClip
          from={240}
          durationInFrames={60}
          trimBefore={sourceFrame(77.5)}
          trimAfter={sourceFrame(79.5)}
          offsetY={-340}
        />
        <Sequence from={300} durationInFrames={60}>
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
    </AbsoluteFill>
  )
}
