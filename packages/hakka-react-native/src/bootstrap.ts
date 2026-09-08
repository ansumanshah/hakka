import { Hakka, mockEngine } from 'hakka-core/runtime'

import { rnCaptureAdapter, rnMockBridge } from './native/nativeAdapter'

Hakka.registerNativeAdapter(rnCaptureAdapter)
mockEngine.registerNativeBridge(rnMockBridge)
