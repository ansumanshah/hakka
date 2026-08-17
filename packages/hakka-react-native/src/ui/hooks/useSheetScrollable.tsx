/**
 * useSheetScrollable — bridges @gorhom/bottom-sheet's gesture system into
 * whichever FlashList is mounted as the sheet's content, so list scrolling
 * and the sheet's drag-to-resize gesture don't fight each other. Uses
 * gorhom's `useBottomSheetScrollableCreator` + FlashList's
 * `renderScrollComponent` (the deprecated `BottomSheetFlatList` used to do
 * this).
 *
 * `useBottomSheetScrollableCreator()` only works inside a `<BottomSheet>`
 * descendant — HakkaInspector wraps content in `SheetScrollableInjector` only
 * in the non-fullscreen sheet branch, so `useSheetScrollable()` returns
 * `undefined` in fullscreen mode or outside a sheet. Every FlashList
 * consumer treats `undefined` as "use the default scroll view".
 */
import { useBottomSheetScrollableCreator } from '@gorhom/bottom-sheet'
import React, { createContext, useContext, type ReactNode } from 'react'

export type SheetRenderScrollComponent = ReturnType<typeof useBottomSheetScrollableCreator>

const SheetScrollableContext = createContext<SheetRenderScrollComponent | undefined>(undefined)

/** Read from any FlashList-owning screen; pass straight through as `renderScrollComponent`. */
export function useSheetScrollable(): SheetRenderScrollComponent | undefined {
  return useContext(SheetScrollableContext)
}

/** Mount once, as a direct child of `<BottomSheet>`, wrapping the sheet's page content. */
export function SheetScrollableInjector({ children }: { children: ReactNode }) {
  const renderScrollComponent = useBottomSheetScrollableCreator()
  return <SheetScrollableContext.Provider value={renderScrollComponent}>{children}</SheetScrollableContext.Provider>
}
