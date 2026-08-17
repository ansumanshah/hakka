import { StyleSheet } from 'react-native'

import { createStyleSheet } from '../styles/createStyleSheet'

export const CHART_BAR_WIDTH = 28
export const CHART_BAR_GAP = 4

export const createStyles = createStyleSheet((theme) => ({
  // `xl` (16) is the panel gutter, shared with the inspector header, filter
  // bar, and request rows — keep it consistent so sections stay aligned.
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: 1,
  },
  backButton: {
    width: theme.controlHeight.nav,
    height: theme.controlHeight.nav,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  title: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.semibold,
  },
  headerRight: {
    width: 40,
  },
  domainRow: {
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
  },
  domainBadges: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: theme.spacing.lg,
  },
  monitorHero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    marginHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
    minHeight: 72, // ui-token-check-ignore: monitor hero card
    backgroundColor: theme.colors.backgroundAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
  },
  monitorHeroRail: {
    width: 4,
    height: 42, // ui-token-check-ignore: monitor hero rail
    borderRadius: theme.radius.xs,
  },
  monitorHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  monitorHeroLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0,
    marginBottom: theme.spacing.xxs,
  },
  monitorHeroTitle: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    lineHeight: 20,
  },
  monitorHeroMeta: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    marginTop: theme.spacing.xxs,
  },
  monitorHeroScore: {
    width: 54,
    alignItems: 'flex-end',
  },
  monitorHeroScoreValue: {
    fontSize: theme.fontSize.hero,
    lineHeight: 28,
    fontWeight: theme.fontWeight.bold,
    fontVariant: ['tabular-nums'] as const,
  },
  monitorHeroScoreLabel: {
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.semibold,
  },
  metricGrid: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
  },
  metricCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: theme.colors.backgroundAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
  performanceGrid: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
  },
  performanceFpsCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 112, // ui-token-check-ignore: stat card
    backgroundColor: theme.colors.backgroundAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.lg,
    padding: theme.spacing.md,
    justifyContent: 'space-between',
  },
  sparkline: {
    height: 48, // ui-token-check-ignore: sparkline plot area
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xxs,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.background,
    overflow: 'hidden',
  },
  sparklineBar: {
    flex: 1,
    minWidth: 2,
    borderRadius: theme.radius.xs,
  },
  performanceCardFooter: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  performanceResourceGrid: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  performanceResourceCard: {
    flex: 1,
    minWidth: 0,
    minHeight: 74, // ui-token-check-ignore: performance card
    backgroundColor: theme.colors.backgroundAlt,
    borderColor: theme.colors.border,
    borderWidth: 1,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    justifyContent: 'space-between',
  },
  performanceDetailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.md,
  },
  performanceDetailItem: {
    flexBasis: '31%',
    minWidth: 92,
    minHeight: 48, // ui-token-check-ignore: detail card
    backgroundColor: theme.colors.background,
    borderColor: theme.colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    justifyContent: 'space-between',
  },
  performanceDetailLabel: {
    color: theme.colors.textSubtle,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.medium,
  },
  performanceDetailValue: {
    color: theme.colors.text,
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.semibold,
    fontVariant: ['tabular-nums'] as const,
  },
  performanceLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  performanceValue: {
    flexShrink: 1,
    textAlign: 'right',
    fontSize: theme.fontSize.hero,
    lineHeight: 30,
    fontWeight: theme.fontWeight.bold,
    fontVariant: ['tabular-nums'] as const,
  },
  performanceUnit: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
  },
  resourceValue: {
    fontSize: theme.fontSize.display,
    lineHeight: 25,
    fontWeight: theme.fontWeight.bold,
    fontVariant: ['tabular-nums'] as const,
  },
  resourceUnit: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.medium,
  },
  metricValue: {
    fontSize: theme.fontSize.xl,
    fontWeight: theme.fontWeight.bold,
    fontVariant: ['tabular-nums'] as const,
    lineHeight: 20,
  },
  metricLabel: {
    color: theme.colors.textMuted,
    fontSize: theme.fontSize.xs,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
    marginTop: theme.spacing.xxs,
  },
  metricCaption: {
    color: theme.colors.textSubtle,
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing.xxs,
  },
  sectionTitle: {
    fontSize: theme.fontSize.md,
    fontWeight: theme.fontWeight.bold,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: theme.spacing.xl,
    marginBottom: theme.spacing.sm,
  },
  chartContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    height: 150, // ui-token-check-ignore: bar-chart plot area
    paddingHorizontal: theme.spacing.xl,
    gap: CHART_BAR_GAP,
  },
  chartBarWrapper: {
    width: CHART_BAR_WIDTH,
    alignItems: 'center',
    justifyContent: 'flex-end',
  },
  chartBar: {
    width: CHART_BAR_WIDTH - 4,
    borderRadius: theme.radius.sm,
    minHeight: 4, // ui-token-check-ignore: chart bar floor so a zero bar stays visible
  },
  chartBarLabel: {
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing.xs,
    fontFamily: 'monospace',
  },
  errorRateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
    gap: theme.spacing.sm,
  },
  errorRateDomain: {
    fontSize: theme.fontSize.xs,
    flex: 1,
    fontFamily: 'monospace',
  },
  errorRateBarContainer: {
    width: 60,
    height: 8, // ui-token-check-ignore: error-rate bar thickness
    backgroundColor: theme.colors?.border ?? '#333',
    borderRadius: theme.radius.sm,
    overflow: 'hidden',
  },
  errorRateBar: {
    height: '100%',
    borderRadius: theme.radius.sm,
  },
  errorRateValue: {
    fontSize: theme.fontSize.xs,
    width: 70,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
  topListIndex: {
    fontSize: theme.fontSize.sm,
    width: 20,
    fontWeight: '600',
  },
  topListUrl: {
    fontSize: theme.fontSize.sm,
    fontFamily: 'monospace',
  },
  topListMeta: {
    fontSize: theme.fontSize.xs,
    marginTop: theme.spacing.xxs,
  },
}))
