import type { NetworkRequest } from 'hakka-core'
/**
 * TimelineView — waterfall chart for request timing.
 * Pure RN, no SVG. Requests as horizontal bars on a shared time axis.
 */
import React, { useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'

import { statusColor, useTheme } from '../styles'

interface TimelineViewProps {
  logs: NetworkRequest[]
  onSelect: (req: NetworkRequest) => void
}

const LABEL_WIDTH = 130
const BAR_AREA_WIDTH = 220
const ROW_HEIGHT = 32
const MIN_BAR_WIDTH = 4
const TICK_COUNT = 5
const SMALL_TEXT_SIZE = 12

function getUrlPath(url: string): string {
  try {
    const withoutProtocol = url.replace(/^https?:\/\//, '')
    const slashIndex = withoutProtocol.indexOf('/')
    const path = slashIndex === -1 ? '/' : withoutProtocol.slice(slashIndex)
    return (path || '/').substring(0, 28)
  } catch {
    return url.substring(0, 28)
  }
}

function formatTickMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.round(ms)}ms`
}

export const TimelineView = React.memo(function TimelineView({ logs, onSelect }: TimelineViewProps) {
  const theme = useTheme()
  const { colors, fontSize: f } = theme

  const { sorted, minTime, totalDuration, ticks } = useMemo(() => {
    if (logs.length === 0) {
      return { sorted: [], minTime: 0, totalDuration: 1, ticks: [] }
    }

    const sorted = sortImmutable(logs, (a, b) => a.startTime - b.startTime)
    const minTime = sorted[0].startTime
    const maxEnd = Math.max(
      ...sorted.map((r) => {
        const end = r.endTime ?? r.startTime + (r.duration ?? 0)
        return end
      }),
    )
    const totalDuration = Math.max(maxEnd - minTime, 1)

    const tickStep = totalDuration / TICK_COUNT
    const ticks = Array.from({ length: TICK_COUNT + 1 }, (_, i) => i * tickStep)

    return { sorted, minTime, totalDuration, ticks }
  }, [logs])

  if (logs.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <Text style={{ color: colors.textMuted, fontSize: f.sm }}>No requests yet</Text>
      </View>
    )
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: colors.background }} showsVerticalScrollIndicator={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ minWidth: LABEL_WIDTH + BAR_AREA_WIDTH + 60 }}>
          <View
            style={{
              flexDirection: 'row',
              paddingLeft: LABEL_WIDTH,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
              paddingBottom: theme.spacing.xs,
              paddingTop: theme.spacing.md,
              backgroundColor: colors.headerBg,
            }}
          >
            {ticks.map((tick, i) => (
              <View
                key={`tick:${tick}`}
                style={{
                  width: BAR_AREA_WIDTH / TICK_COUNT,
                  alignItems: i === 0 ? 'flex-start' : 'center',
                }}
              >
                <Text style={{ fontSize: SMALL_TEXT_SIZE, color: colors.textMuted }}>{formatTickMs(tick)}</Text>
              </View>
            ))}
          </View>

          {sorted.map((req, index) => {
            const reqStart = req.startTime - minTime
            const reqDuration = req.duration ?? 0
            const reqEnd = req.endTime ? req.endTime - minTime : reqStart + reqDuration
            const actualDuration = reqEnd - reqStart

            const leftOffset = (reqStart / totalDuration) * BAR_AREA_WIDTH
            const barWidth = Math.max(MIN_BAR_WIDTH, (actualDuration / totalDuration) * BAR_AREA_WIDTH)
            const barColor = statusColor(req.status ?? undefined)
            const isEven = index % 2 === 0

            return (
              <Pressable
                key={req.id}
                onPress={() => onSelect(req)}
                style={({ pressed }) => [
                  {
                    flexDirection: 'row',
                    alignItems: 'center',
                    height: ROW_HEIGHT,
                    backgroundColor: isEven ? colors.background : colors.backgroundAlt,
                    borderBottomWidth: 0.5,
                    borderBottomColor: colors.border,
                  },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <View
                  style={{
                    width: LABEL_WIDTH,
                    paddingHorizontal: theme.spacing.md,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.spacing.xs,
                  }}
                >
                  <Text
                    style={{
                      fontSize: SMALL_TEXT_SIZE,
                      fontWeight: '700',
                      color: barColor,
                      width: 30,
                    }}
                  >
                    {req.method.toUpperCase().substring(0, 4)}
                  </Text>
                  <Text numberOfLines={1} style={{ fontSize: SMALL_TEXT_SIZE, color: colors.text, flex: 1 }}>
                    {getUrlPath(req.url)}
                  </Text>
                </View>

                <View
                  style={{ width: BAR_AREA_WIDTH, position: 'relative', height: ROW_HEIGHT, justifyContent: 'center' }}
                >
                  {ticks.slice(1).map((tick) => (
                    <View
                      key={`grid:${tick}`}
                      style={{
                        position: 'absolute',
                        left: (tick / totalDuration) * BAR_AREA_WIDTH,
                        top: 0,
                        bottom: 0,
                        width: 0.5,
                        backgroundColor: colors.border,
                      }}
                    />
                  ))}

                  <View
                    style={{
                      position: 'absolute',
                      left: leftOffset,
                      width: barWidth,
                      height: 14, // ui-token-check-ignore: timeline bar thickness
                      borderRadius: theme.radius.sm,
                      backgroundColor: barColor,
                      opacity: 0.85,
                    }}
                  />
                </View>

                <View style={{ paddingHorizontal: 8, minWidth: 60, alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: SMALL_TEXT_SIZE, color: barColor, fontWeight: '600' }}>
                    {req.status ?? '—'}
                  </Text>
                  <Text style={{ fontSize: SMALL_TEXT_SIZE, color: colors.textMuted }}>
                    {req.duration != null ? `${Math.round(req.duration)}ms` : '…'}
                  </Text>
                </View>
              </Pressable>
            )
          })}
        </View>
      </ScrollView>
    </ScrollView>
  )
})

function sortImmutable<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  const valuesWithToSorted = values as {
    toSorted?: (compareFn: ((left: T, right: T) => number) | undefined) => T[]
  }
  if (typeof valuesWithToSorted.toSorted === 'function') return valuesWithToSorted.toSorted(compare)
  return values.slice().sort(compare)
}
