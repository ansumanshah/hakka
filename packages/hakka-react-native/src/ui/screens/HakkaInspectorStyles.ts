import { StyleSheet } from 'react-native'

import { createStyleSheet } from '../styles/createStyleSheet'

export const createStyles = createStyleSheet((theme) => ({
  container: {
    position: 'absolute',
    zIndex: 9999,
  },
  fullscreenOverlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
  },
  hud: {
    // Column so the expanded HUD's recent-requests list stacks below the top row.
    flexDirection: 'column',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 4,
  },
  hudTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hudMain: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
    paddingLeft: theme.spacing.sm,
    paddingRight: theme.spacing.xs,
  },
  hudHealthRail: {
    width: 4,
    height: 34, // ui-token-check-ignore: bubble health rail
    borderRadius: theme.radius.xs,
  },
  hudMark: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudRequestBlock: {
    width: 42,
    justifyContent: 'center',
  },
  hudRequestValue: {
    fontSize: theme.fontSize.lg,
    fontWeight: theme.fontWeight.bold,
    fontVariant: ['tabular-nums'] as const,
    lineHeight: 17,
  },
  hudRequestLabel: {
    fontSize: theme.fontSize.xxs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0,
    lineHeight: 11,
  },
  hudMetrics: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
  },
  hudMetric: {
    flex: 1,
    minWidth: 0,
    minHeight: theme.controlHeight.field,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: theme.radius.sm,
    backgroundColor: theme.colors.background,
    paddingHorizontal: theme.spacing.xs,
  },
  hudMetricValue: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.bold,
    fontVariant: ['tabular-nums'] as const,
    lineHeight: 15,
  },
  hudMetricLabel: {
    fontSize: theme.fontSize.xxs,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 0,
    lineHeight: 11,
  },
  hudActions: {
    width: 40,
    height: '100%',
    borderLeftWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudIconButton: {
    width: 34,
    height: theme.controlHeight.icon,
    justifyContent: 'center',
    alignItems: 'center',
  },
  hudRecentList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  hudRecentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    minHeight: 20, // ui-token-check-ignore: one recent-request line in the expanded bubble
  },
  hudRecentPath: {
    flex: 1,
    minWidth: 0,
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
  },
  hudRecentStatus: {
    fontSize: theme.fontSize.xs,
    fontFamily: 'monospace',
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ['tabular-nums'] as const,
    minWidth: 28,
    textAlign: 'right' as const,
  },
  hudRecentEmpty: {
    fontSize: theme.fontSize.xs,
    paddingVertical: theme.spacing.xs,
  },
  hideZone: {
    position: 'absolute',
    height: 60, // ui-token-check-ignore: drag-to-hide drop zone
    backgroundColor: 'rgba(158, 158, 158, 0.2)',
    borderRadius: theme.radius.lg,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9998,
  },
  hideZoneText: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
  },
  fullContainer: {
    flex: 1,
  },
  sheetShadow: {
    // No border here: this style lands on BottomSheet's square-cornered OUTER
    // container. The 20pt radii + border live on `backgroundStyle` below, so
    // the border follows the rounded surface instead of tracing a rectangle around it.
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  sheetBackground: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  pausedBanner: {
    flexDirection: 'row' as const,
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: theme.spacing.xs,
  },
  pausedBannerText: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  bulkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    gap: theme.spacing.xs,
    borderTopWidth: 1,
  },
  bulkBarCount: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
    marginRight: theme.spacing.xs,
  },
  bulkBtn: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius.sm,
  },
  bulkBtnText: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
}))
