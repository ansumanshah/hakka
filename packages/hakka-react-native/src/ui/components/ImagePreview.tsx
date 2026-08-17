import React, { useMemo, useState } from 'react'
// react-doctor-disable-next-line react-doctor/rn-prefer-expo-image -- keep expo-image optional for the SDK package.
import { ActivityIndicator, Image, Text, useWindowDimensions, View } from 'react-native'

import { createStyleSheet, spacing, useTheme } from '../styles'

interface ImagePreviewProps {
  uri: string
  alt?: string
}

type ImageLoadEvent = {
  nativeEvent: {
    source: {
      width: number
      height: number
    }
  }
}

export const ImagePreview: React.FC<ImagePreviewProps> = ({ uri, alt }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme
  const { width: windowWidth } = useWindowDimensions()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [naturalDimensions, setNaturalDimensions] = useState<{ width: number; height: number } | null>(null)

  const maxWidth = Math.max(1, windowWidth - spacing.xl * 2)
  const maxHeight = 400

  const displayDimensions = useMemo(() => {
    if (!naturalDimensions) {
      return null
    }

    const { width, height } = naturalDimensions
    let scaledWidth = width
    let scaledHeight = height

    if (width > maxWidth) {
      scaledWidth = maxWidth
      scaledHeight = (height / width) * maxWidth
    }

    if (scaledHeight > maxHeight) {
      scaledHeight = maxHeight
      scaledWidth = (width / height) * maxHeight
    }

    return { width: scaledWidth, height: scaledHeight }
  }, [naturalDimensions, maxWidth, maxHeight])

  const handleLoad = (event: ImageLoadEvent) => {
    setLoading(false)
    const { width, height } = event.nativeEvent.source
    setNaturalDimensions({ width, height })
  }

  const handleError = () => {
    setLoading(false)
    setError(true)
  }

  if (error) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: colors.backgroundAlt, borderColor: colors.border }]}>
        <Text style={[styles.errorText, { color: colors.error }]}>Failed to load image</Text>
        {alt && <Text style={[styles.altText, { color: colors.textMuted }]}>{alt}</Text>}
      </View>
    )
  }

  return (
    <View style={styles.container}>
      {loading && (
        <View style={[styles.loadingContainer, { backgroundColor: colors.backgroundAlt }]}>
          <ActivityIndicator size="large" color={colors.textMuted} />
          <Text style={[styles.loadingText, { color: colors.textMuted }]}>Loading image…</Text>
        </View>
      )}

      <Image
        source={{ uri }}
        style={[
          {
            borderRadius: theme.radius.md,
            borderWidth: 1,
          },
          displayDimensions
            ? { width: displayDimensions.width, height: displayDimensions.height }
            : { width: maxWidth, height: 200 },
          { backgroundColor: colors.backgroundAlt, borderColor: colors.border },
        ]}
        resizeMode="contain"
        onLoad={handleLoad}
        onError={handleError}
      />

      {displayDimensions && !loading && (
        <Text style={[styles.dimensionsText, { color: colors.textSubtle }]}>
          {displayDimensions.width.toFixed(0)} × {displayDimensions.height.toFixed(0)}
        </Text>
      )}
    </View>
  )
}

const createStyles = createStyleSheet(({ spacing, radius, fontSize }) => ({
  container: {
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
    borderRadius: radius.md,
  },
  loadingText: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
  },
  dimensionsText: {
    marginTop: spacing.xs,
    fontSize: fontSize.xs,
    fontFamily: 'monospace',
  },
  errorContainer: {
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
    marginVertical: spacing.md,
  },
  errorText: {
    fontSize: fontSize.md,
    fontWeight: '600',
    marginBottom: spacing.xs,
  },
  altText: {
    fontSize: fontSize.sm,
    textAlign: 'center',
  },
}))
