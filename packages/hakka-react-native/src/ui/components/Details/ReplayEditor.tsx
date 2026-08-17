import { FlashList } from '@shopify/flash-list'
import type { NetworkRequest } from 'hakka-core'
/**
 * ReplayEditor — modal for editing a request before replay.
 * Long-press the retry button in Header to open.
 *
 * Both lists below render inside a native RN `Modal` (its own presentation
 * layer, not the gorhom bottom sheet), so neither needs the
 * `renderScrollComponent` sheet-gesture bridge — there's no sheet-drag
 * gesture in this tree to fight with.
 */
import React, { useCallback, useMemo, useReducer } from 'react'
import { Modal, Pressable, Text, TextInput, View } from 'react-native'

import { X } from '../../icons'
import { createStyleSheet, radius, useTheme } from '../../styles'

export interface EditableRequest {
  method: string
  url: string
  headers: string // JSON string
  body: string
}

interface ReplayEditorProps {
  request: NetworkRequest
  visible: boolean
  onClose: () => void
  onSend: (edited: EditableRequest) => void
  sendStatus: 'idle' | 'pending' | 'success' | 'error'
}

interface EditorRow {
  id: 'method' | 'url' | 'headers' | 'body'
}

interface MethodOption {
  value: string
  onPress: () => void
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const BASE_EDITOR_ROWS: readonly EditorRow[] = [{ id: 'method' }, { id: 'url' }, { id: 'headers' }]
const BODY_EDITOR_ROW: EditorRow = { id: 'body' }

interface ReplayEditorState {
  method: string
  url: string
  headers: string
  body: string
  headersError: boolean
}

type ReplayEditorAction =
  | { type: 'method'; value: string }
  | { type: 'url'; value: string }
  | { type: 'headers'; value: string }
  | { type: 'body'; value: string }

function createReplayEditorState(request: NetworkRequest): ReplayEditorState {
  let headers = '{}'
  try {
    headers = JSON.stringify(request.requestHeaders ?? {}, null, 2)
  } catch {
    headers = '{}'
  }

  return {
    method: request.method?.toUpperCase() ?? 'GET',
    url: request.url ?? '',
    headers,
    body: request.requestBody ?? '',
    headersError: false,
  }
}

function replayEditorReducer(state: ReplayEditorState, action: ReplayEditorAction): ReplayEditorState {
  switch (action.type) {
    case 'method':
      return { ...state, method: action.value }
    case 'url':
      return { ...state, url: action.value }
    case 'headers': {
      let headersError = false
      try {
        JSON.parse(action.value)
      } catch {
        headersError = true
      }
      return { ...state, headers: action.value, headersError }
    }
    case 'body':
      return { ...state, body: action.value }
  }
}

export const ReplayEditor: React.FC<ReplayEditorProps> = ({ request, visible, onClose, onSend, sendStatus }) => {
  const theme = useTheme()
  const styles = createStyles(theme)
  const { colors } = theme

  const [state, dispatch] = useReducer(replayEditorReducer, request, createReplayEditorState)

  const validateHeaders = useCallback((val: string) => {
    dispatch({ type: 'headers', value: val })
  }, [])

  const handleSend = useCallback(() => {
    if (state.headersError) return
    onSend({ method: state.method, url: state.url, headers: state.headers, body: state.body })
  }, [onSend, state.body, state.headers, state.headersError, state.method, state.url])

  const methodRows = useMemo<readonly EditorRow[]>(() => {
    if (state.method === 'GET' || state.method === 'HEAD') return BASE_EDITOR_ROWS
    return [...BASE_EDITOR_ROWS, BODY_EDITOR_ROW]
  }, [state.method])

  const handleSelectMethod = useCallback((value: string) => {
    dispatch({ type: 'method', value })
  }, [])

  const methodOptions = useMemo<readonly MethodOption[]>(
    () => HTTP_METHODS.map((value) => ({ value, onPress: () => handleSelectMethod(value) })),
    [handleSelectMethod],
  )

  const renderMethodPill = useCallback(
    ({ item }: { item: MethodOption }) => (
      <Pressable
        onPress={item.onPress}
        style={[
          styles.methodPill,
          {
            backgroundColor: state.method === item.value ? '#6366f1' : colors.backgroundAlt,
            borderColor: state.method === item.value ? '#6366f1' : colors.border,
          },
        ]}
      >
        <Text style={[styles.methodText, { color: state.method === item.value ? '#fff' : colors.text }]}>
          {item.value}
        </Text>
      </Pressable>
    ),
    [colors.backgroundAlt, colors.border, colors.text, state.method, styles.methodPill, styles.methodText],
  )

  const renderEditorItem = useCallback(
    ({ item }: { item: EditorRow }) => {
      if (item.id === 'method') {
        return (
          <>
            <Text style={[styles.label, { color: colors.textMuted }]}>METHOD</Text>
            <FlashList
              horizontal
              data={methodOptions}
              keyExtractor={(methodItem) => methodItem.value}
              showsHorizontalScrollIndicator={false}
              renderItem={renderMethodPill}
              contentContainerStyle={styles.methodRow}
            />
          </>
        )
      }

      if (item.id === 'url') {
        return (
          <>
            <Text style={[styles.label, { color: colors.textMuted }]}>URL</Text>
            <TextInput
              style={[
                styles.input,
                { color: colors.text, borderColor: colors.border, backgroundColor: colors.backgroundAlt },
              ]}
              value={state.url}
              onChangeText={(value) => dispatch({ type: 'url', value })}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://..."
              placeholderTextColor={colors.textMuted}
            />
          </>
        )
      }

      if (item.id === 'headers') {
        return (
          <>
            <View style={styles.labelRow}>
              <Text style={[styles.label, { color: colors.textMuted }]}>HEADERS (JSON)</Text>
              {state.headersError && (
                <Text style={[styles.errorBadge, { color: colors.error ?? '#ef4444' }]}>Invalid JSON</Text>
              )}
            </View>
            <TextInput
              style={[
                styles.inputMulti,
                {
                  color: colors.text,
                  borderColor: state.headersError ? (colors.error ?? '#ef4444') : colors.border,
                  backgroundColor: colors.backgroundAlt,
                  fontFamily: 'monospace',
                },
              ]}
              value={state.headers}
              onChangeText={validateHeaders}
              multiline
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="{}"
              placeholderTextColor={colors.textMuted}
              scrollEnabled={false}
            />
          </>
        )
      }

      return (
        <>
          <Text style={[styles.label, { color: colors.textMuted }]}>BODY</Text>
          <TextInput
            style={[
              styles.inputMulti,
              {
                color: colors.text,
                borderColor: colors.border,
                backgroundColor: colors.backgroundAlt,
                fontFamily: 'monospace',
              },
            ]}
            value={state.body}
            onChangeText={(value) => dispatch({ type: 'body', value })}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            placeholder='{"key": "value"}'
            placeholderTextColor={colors.textMuted}
            scrollEnabled={false}
          />
        </>
      )
    },
    [
      colors.backgroundAlt,
      colors.border,
      colors.error,
      colors.text,
      colors.textMuted,
      methodOptions,
      renderMethodPill,
      state.body,
      state.headers,
      state.headersError,
      state.url,
      styles.errorBadge,
      styles.input,
      styles.inputMulti,
      styles.label,
      styles.labelRow,
      styles.methodRow,
      validateHeaders,
    ],
  )

  const isSending = sendStatus === 'pending'

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.border }]}>
          <View style={[styles.titleBar, { borderBottomColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]}>Edit & Replay</Text>
            <Pressable onPress={onClose} hitSlop={12}>
              <X size={16} color={colors.textMuted} />
            </Pressable>
          </View>

          <FlashList
            style={styles.body}
            data={methodRows}
            keyExtractor={(item) => item.id}
            renderItem={renderEditorItem}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
          />

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={handleSend}
              disabled={isSending || state.headersError}
              style={[
                styles.sendBtn,
                {
                  backgroundColor:
                    sendStatus === 'success'
                      ? (colors.success ?? '#22c55e')
                      : sendStatus === 'error'
                        ? (colors.error ?? '#ef4444')
                        : '#6366f1',
                  opacity: isSending || state.headersError ? 0.6 : 1,
                },
              ]}
            >
              <Text style={styles.sendText}>
                {isSending
                  ? 'Sending…'
                  : sendStatus === 'success'
                    ? 'Success'
                    : sendStatus === 'error'
                      ? 'Failed'
                      : `Send ${state.method}`}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  )
}

const createStyles = createStyleSheet(({ spacing, fontSize, fontWeight }) => ({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    maxHeight: '90%',
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
  body: {
    flex: 1,
  },
  bodyContent: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.8,
    marginBottom: spacing.xs,
    marginTop: spacing.sm,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  errorBadge: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  methodRow: {
    flexDirection: 'row',
    marginBottom: spacing.xs,
  },
  methodPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    marginRight: spacing.xs,
  },
  methodText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    fontFamily: 'monospace',
  },
  input: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
  },
  inputMulti: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: fontSize.sm,
    minHeight: 80, // ui-token-check-ignore: multi-line body editor
    textAlignVertical: 'top',
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
  },
  sendBtn: {
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  sendText: {
    color: '#fff',
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
  },
}))
