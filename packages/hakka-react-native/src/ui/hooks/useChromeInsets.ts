import { useSafeAreaInsets } from './useSafeArea'
import { useSheetScrollable } from './useSheetScrollable'

/**
 * Top inset for a page rendered inside the inspector chrome.
 *
 * Inside the bottom sheet the screen sits 40%+ down the display, nowhere near
 * the notch/Dynamic Island — applying the device top inset there would add
 * dead space above the title, so return 0. `useSheetScrollable()` is defined
 * only for descendants of `<BottomSheet>`, so its presence is the
 * sheet/fullscreen signal.
 */
export function useChromeTopInset(): number {
  const insets = useSafeAreaInsets()
  const insideSheet = useSheetScrollable() !== undefined
  return insideSheet ? 0 : insets.top
}
