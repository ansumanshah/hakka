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

export const Comparison = () => {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const entrance = (start: number) =>
    spring({ frame: Math.max(0, frame - start), fps, config: { damping: 21, stiffness: 130 } })
  const introOut = progress(frame, 82, 100)
  const productIn = progress(frame, 90, 103)
  const weight = progress(frame, 31, 60)
  const productScale = interpolate(frame, [90, 190, 245, 299], [0.98, 1.02, 1.35, 1.35], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const responseIn = progress(frame, 216, 226)
  const requestOut = progress(frame, 205, 216)

  return (
    <AbsoluteFill style={{ background: '#111110', color: '#f2eee8', fontFamily: 'Geist' }}>
      <div
        style={{
          position: 'absolute',
          top: 52,
          left: 104,
          zIndex: 5,
          fontSize: 34,
          fontWeight: 700,
          letterSpacing: -1.5,
        }}
      >
        <span style={{ color: '#ee8320', marginRight: 9 }}>•</span>hakka
      </div>
      <div
        style={{
          position: 'absolute',
          top: 68,
          right: 104,
          zIndex: 5,
          fontFamily: 'Geist Mono',
          fontSize: 16,
          letterSpacing: 1,
          color: '#b8b4ad',
        }}
      >
        REAL INSPECTOR / DEMO TRAFFIC
      </div>

      <AbsoluteFill
        style={{
          opacity: 1 - introOut,
          transform: `translateY(${-24 * introOut}px)`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 217,
            left: 104,
            color: '#b8b4ad',
            fontFamily: 'Geist Mono',
            fontSize: 18,
            letterSpacing: 2,
            opacity: progress(frame, 3, 15),
          }}
        >
          EVERY BUG LEAVES A TRACE.
        </div>
        <div style={{ position: 'absolute', top: 258, left: 104, fontSize: 174, lineHeight: 0.99, letterSpacing: -10 }}>
          <div>
            <span
              style={{
                display: 'inline-block',
                opacity: progress(frame, 9, 25),
                transform: `translateY(${(1 - entrance(9)) * 42}px)`,
                fontWeight: 450,
              }}
            >
              Something
            </span>
          </div>
          <div>
            <span
              style={{
                display: 'inline-block',
                opacity: progress(frame, 18, 34),
                transform: `translateY(${(1 - entrance(18)) * 42}px)`,
                fontVariationSettings: `'wght' ${450 + 250 * weight}`,
                color: interpolateColors(weight, [0, 1], ['#f2eee8', '#ef745e']),
              }}
            >
              broke.
            </span>
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            top: 410,
            right: 260,
            opacity: progress(frame, 25, 42),
            transform: `translateY(${(1 - entrance(26)) * 32}px)`,
          }}
        >
          <div style={{ color: '#b8b4ad', fontFamily: 'Geist Mono', fontSize: 18, letterSpacing: 2 }}>HTTP STATUS</div>
          <div style={{ color: '#ef745e', fontSize: 176, lineHeight: 1, fontWeight: 600, letterSpacing: -10 }}>500</div>
        </div>
        <div
          style={{
            position: 'absolute',
            top: 720,
            left: 104,
            width: 1712,
            border: '1px solid #43342d',
            boxShadow: '0 20px 80px #0005',
            opacity: progress(frame, 38, 54),
            transform: `translateX(${(1 - entrance(38)) * 68}px)`,
          }}
        >
          <Img src={staticFile('failed-request.png')} style={{ display: 'block', width: '100%' }} />
        </div>
        <div
          style={{
            position: 'absolute',
            top: 846,
            left: 104,
            fontSize: 28,
            color: '#b8b4ad',
            opacity: progress(frame, 52, 66),
          }}
        >
          Start with the request.
        </div>
      </AbsoluteFill>

      <AbsoluteFill style={{ opacity: productIn, pointerEvents: 'none' }}>
        <div
          style={{
            position: 'absolute',
            top: 149,
            left: 104,
            color: '#b8b4ad',
            fontFamily: 'Geist Mono',
            fontSize: 18,
            letterSpacing: 2,
          }}
        >
          {frame < 220 ? 'FOLLOW THE FAILURE' : 'READ THE EVIDENCE'}
        </div>
        <div
          style={{
            position: 'absolute',
            top: 190,
            left: 104,
            fontSize: 96,
            letterSpacing: -5,
            opacity: progress(frame, 96, 106) * (1 - requestOut),
          }}
        >
          <div style={{ transform: `translateY(${(1 - entrance(102)) * 30}px)` }}>
            Find the <span style={{ color: '#ee8320' }}>request.</span>
          </div>
        </div>
        <div
          style={{ position: 'absolute', top: 190, left: 104, fontSize: 96, letterSpacing: -5, opacity: responseIn }}
        >
          <div style={{ transform: `translateY(${(1 - entrance(216)) * 30}px)` }}>
            See what <span style={{ color: '#ee8320' }}>came back.</span>
          </div>
        </div>
        <div
          style={{
            position: 'absolute',
            top: 330,
            left: 104,
            width: 1712,
            height: 722,
            border: '1px solid #43342d',
            borderRadius: 18,
            overflow: 'hidden',
            boxShadow: '0 30px 90px #0008',
            transform: `translateY(${(1 - productIn) * 36}px)`,
          }}
        >
          <Sequence from={90}>
            <Video
              src={staticFile('workflow.mp4')}
              muted
              objectFit="cover"
              style={{
                width: '100%',
                height: '100%',
                transform: `scale(${productScale})`,
                transformOrigin: '72% 58%',
                filter: 'brightness(1.42) contrast(1.04)',
              }}
            />
          </Sequence>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}
