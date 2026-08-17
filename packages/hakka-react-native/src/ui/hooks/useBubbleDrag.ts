import { useCallback, useMemo } from 'react'
import { useWindowDimensions } from 'react-native'
import { Gesture } from 'react-native-gesture-handler'
import { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'

import { lightImpact } from '../utils/haptics'
import type { SafeAreaInsets } from './useSafeArea'

export interface BubblePosition {
  x: number
  y: number
}

export interface GestureConfig {
  initialPosition: BubblePosition
  onDragStart?: () => void
  onDragEnd?: () => void
  onHideZoneEnter?: () => void
  onHideZoneExit?: () => void
  onHideZoneDrop?: () => void
  /**
   * Fires once the long-press gesture activates — held within `maxDistance` for
   * `minDuration` without releasing. A light haptic (`lightImpact`) fires automatically
   * on activation, so the gesture confirms itself before this callback does anything.
   */
  onLongPress?: () => void
  snapToEdge?: boolean
  bubbleWidth?: number
  bubbleHeight?: number
  safeAreaInsets?: SafeAreaInsets
  hideZoneHeight?: number
  /**
   * Disable the bubble's pan gesture — set `false` while the inspector sheet is open.
   * Both the bubble and @gorhom/bottom-sheet use react-native-gesture-handler, so a
   * sheet-dismiss swipe passing through the bubble's region can also be recognized by
   * the bubble's pan gesture, tripping hide-zone-drop and hiding the bubble (a real,
   * reproduced regression). Default true.
   */
  enabled?: boolean
}

const spring = {
  damping: 18,
  stiffness: 240,
  mass: 0.7,
}

// Long-press-to-open-inspector tuning. maxDistance is deliberately tight — it's the
// entire mechanism that keeps a drag from being misread as a long-press (see `gesture` below).
const LONG_PRESS_MIN_DURATION_MS = 450
const LONG_PRESS_MAX_DISTANCE = 10

export const useBubbleDrag = ({
  initialPosition,
  onDragStart,
  onDragEnd,
  onHideZoneEnter,
  onHideZoneExit,
  onHideZoneDrop,
  onLongPress,
  snapToEdge = true,
  bubbleWidth = 60,
  bubbleHeight = 60,
  safeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 },
  hideZoneHeight = 100,
  enabled = true,
}: GestureConfig) => {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions()
  const translateX = useSharedValue(initialPosition.x)
  const translateY = useSharedValue(initialPosition.y)
  const startX = useSharedValue(initialPosition.x)
  const startY = useSharedValue(initialPosition.y)
  const isInHideZone = useSharedValue(false)

  const setPosition = useCallback(
    ({ x, y }: BubblePosition) => {
      translateX.value = x
      translateY.value = y
      startX.value = x
      startY.value = y
    },
    [startX, startY, translateX, translateY],
  )

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }))

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(5)
        .onBegin(() => {
          startX.value = translateX.value
          startY.value = translateY.value
          runOnJS(onDragStart ?? noop)()
        })
        .onUpdate((event) => {
          const nextX = startX.value + event.translationX
          const nextY = startY.value + event.translationY
          translateX.value = nextX
          translateY.value = nextY

          const shouldShowHideZone = nextY > screenHeight / 2
          if (shouldShowHideZone !== isInHideZone.value) {
            isInHideZone.value = shouldShowHideZone
            if (shouldShowHideZone) {
              runOnJS(onHideZoneEnter ?? noop)()
            } else {
              runOnJS(onHideZoneExit ?? noop)()
            }
          }
        })
        .onEnd(() => {
          runOnJS(onDragEnd ?? noop)()

          const hideZoneY = screenHeight - hideZoneHeight - safeAreaInsets.bottom
          if (translateY.value > hideZoneY - 20) {
            isInHideZone.value = false
            runOnJS(onHideZoneDrop ?? noop)()
            return
          }

          if (snapToEdge) {
            const snapToLeft = translateX.value < screenWidth / 2
            const targetX = snapToLeft
              ? safeAreaInsets.left + 10
              : screenWidth - bubbleWidth - safeAreaInsets.right - 10
            const minY = safeAreaInsets.top + 50
            const maxY = screenHeight - bubbleHeight - hideZoneHeight - safeAreaInsets.bottom - 30
            const targetY = Math.max(minY, Math.min(translateY.value, maxY))

            translateX.value = withSpring(targetX, spring)
            translateY.value = withSpring(targetY, spring)
            startX.value = targetX
            startY.value = targetY
          }

          isInHideZone.value = false
        })
        .enabled(enabled),
    [
      bubbleHeight,
      bubbleWidth,
      enabled,
      hideZoneHeight,
      isInHideZone,
      onDragEnd,
      onDragStart,
      onHideZoneDrop,
      onHideZoneEnter,
      onHideZoneExit,
      safeAreaInsets.bottom,
      safeAreaInsets.left,
      safeAreaInsets.right,
      safeAreaInsets.top,
      screenHeight,
      screenWidth,
      snapToEdge,
      startX,
      startY,
      translateX,
      translateY,
    ],
  )

  // Recognizes a stationary hold — activates only if the touch never travels
  // past `maxDistance` before `minDuration` elapses.
  const longPressGesture = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(LONG_PRESS_MIN_DURATION_MS)
        .maxDistance(LONG_PRESS_MAX_DISTANCE)
        .onStart(() => {
          runOnJS(lightImpact)()
          runOnJS(onLongPress ?? noop)()
        })
        .enabled(enabled),
    [enabled, onLongPress],
  )

  // Exclusive() gives longPressGesture first claim on every touch; movement past
  // LONG_PRESS_MAX_DISTANCE before LONG_PRESS_MIN_DURATION_MS makes it FAIL its own
  // recognition, handing the touch to panGesture as fallback. "Held still long enough"
  // and "moved far enough to drag" are mutually exclusive by construction — no separate
  // distance threshold needed elsewhere to keep a reposition from also opening the sheet.
  const gesture = useMemo(() => Gesture.Exclusive(longPressGesture, panGesture), [longPressGesture, panGesture])

  return {
    animatedStyle,
    gesture,
    setPosition,
  }
}

function noop(): void {}
