import { Composition } from 'remotion'

import { Comparison } from './Comparison'

export const Root = () => (
  <Composition
    id="HakkaMobileComparison"
    component={Comparison}
    durationInFrames={630}
    fps={30}
    width={1080}
    height={1920}
  />
)
