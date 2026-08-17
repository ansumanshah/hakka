import type { NetworkRequest } from 'hakka-core'
import React, { useState } from 'react'
import { ScrollView, View } from 'react-native'

import { ContentTab } from '../components/Details/ContentTab'
import { GraphQLTab } from '../components/Details/GraphQLTab'
import { Header } from '../components/Details/Header'
import { Overview } from '../components/Details/Overview'
import { Tabs, type TabType } from '../components/Details/Tabs'
import { Timing } from '../components/Details/Timing'
import { WsFramesTab } from '../components/Details/WsFramesTab'
import { useTheme } from '../styles'
import { createStyleSheet } from '../styles/createStyleSheet'

export interface DetailsProps {
  request: NetworkRequest | null
  detailTab: TabType
  onClose: () => void
  onTabChange: (tab: TabType) => void
}

export function Details({ request, detailTab, onClose, onTabChange }: DetailsProps) {
  if (!request) return null

  return (
    <DetailsContent
      key={`${request.id}:${detailTab}`}
      request={request}
      detailTab={detailTab}
      onClose={onClose}
      onTabChange={onTabChange}
    />
  )
}

function DetailsContent({ request, detailTab, onClose, onTabChange }: DetailsProps & { request: NetworkRequest }) {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(0)
  const [totalMatches, setTotalMatches] = useState(0)

  const isWebSocket = request.source === 'websocket' && Array.isArray(request.messages)

  const handleMatchCountChange = (_current: number, total: number) => {
    setTotalMatches(total)
    if (total !== totalMatches) {
      setCurrentMatch(0)
    }
  }

  const handleNextMatch = () => {
    if (totalMatches > 0) {
      setCurrentMatch((prev) => (prev >= totalMatches - 1 ? 0 : prev + 1))
    }
  }

  const handlePrevMatch = () => {
    if (totalMatches > 0) {
      setCurrentMatch((prev) => (prev <= 0 ? totalMatches - 1 : prev - 1))
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Header url={request.url} onClose={onClose} request={request} />
      <Tabs
        activeTab={detailTab}
        onTabChange={onTabChange}
        showGraphql={!!request.graphql}
        showWsFrames={isWebSocket}
        searchValue={searchQuery}
        onSearchChange={setSearchQuery}
        currentMatch={currentMatch + 1}
        totalMatches={totalMatches}
        onNextMatch={handleNextMatch}
        onPrevMatch={handlePrevMatch}
      />

      <ScrollView
        style={[styles.content, { backgroundColor: colors.background }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        {/* Fall back to Overview if the GraphQL tab is active but this request isn't GraphQL,
            or if the WS tab is active but this request isn't a WebSocket. */}
        {(detailTab === 'overview' ||
          (detailTab === 'graphql' && !request.graphql) ||
          (detailTab === 'ws' && !isWebSocket)) && <Overview request={request} />}
        {detailTab === 'timing' && <Timing request={request} />}
        {detailTab === 'graphql' && request.graphql && <GraphQLTab request={request} />}
        {detailTab === 'ws' && isWebSocket && <WsFramesTab request={request} />}
        {(detailTab === 'request' || detailTab === 'response') && (
          <ContentTab
            request={request}
            searchQuery={searchQuery}
            type={detailTab}
            currentMatchIndex={currentMatch}
            onMatchCountChange={handleMatchCountChange}
          />
        )}
      </ScrollView>
    </View>
  )
}

const createStyles = createStyleSheet((theme) => ({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  // The pane insets once here; section headers and KV rows sit flush inside
  // it (no per-row horizontal padding — see Details/helpers.tsx).
  scrollContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xl,
  },
}))
