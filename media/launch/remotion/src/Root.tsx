import { Composition } from 'remotion'

import { Comparison } from './Comparison'

export const Root = () => (
  <Composition
    id="HakkaIntroComparison"
    component={Comparison}
    durationInFrames={300}
    fps={30}
    width={1920}
    height={1080}
  />
)
