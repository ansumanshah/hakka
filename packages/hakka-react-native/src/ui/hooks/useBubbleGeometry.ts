import type { BubbleConfig } from 'hakka-core'
import { useMemo } from 'react'

import type { SafeAreaInsets } from './useSafeArea'

const DEFAULT_BUBBLE_HEIGHT = 56
const DEFAULT_BUBBLE_WIDTH = 264

export interface BubbleGeometry {
  bubbleHeight: number
  bubbleWidth: number
  initialBubblePosition: { x: number; y: number }
}

/** Derives the bubble's size and its top-right resting position from the
 * host's `bubble` config, safe-area insets, and current screen width. Pure
 * geometry — no drag/gesture state, see `useBubbleDrag` for that. */
export function useBubbleGeometry(
  bubble: BubbleConfig,
  safeAreaInsets: SafeAreaInsets,
  screenWidth: number,
): BubbleGeometry {
  const bubbleHeight = Math.max(DEFAULT_BUBBLE_HEIGHT, bubble.size ?? DEFAULT_BUBBLE_HEIGHT)
  const bubbleWidth = Math.max(
    190,
    Math.min(
      DEFAULT_BUBBLE_WIDTH,
      Math.round(bubbleHeight * 4.7),
      screenWidth - safeAreaInsets.left - safeAreaInsets.right - 24,
    ),
  )

  const initialBubblePosition = useMemo(
    () => ({
      x: screenWidth - safeAreaInsets.right - bubbleWidth - 12,
      y: safeAreaInsets.top + 12,
    }),
    [bubbleWidth, safeAreaInsets.right, safeAreaInsets.top, screenWidth],
  )

  return { bubbleHeight, bubbleWidth, initialBubblePosition }
}
