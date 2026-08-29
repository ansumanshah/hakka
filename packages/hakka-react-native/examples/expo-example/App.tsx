import { Hakka, useNetworkLogs } from 'hakka-react-native'
import { useCallback } from 'react'
import { Alert, Pressable, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native'

Hakka.start()

// This example links the native Hakka module through the `hakka-react-native`
// config plugin (see app.json's `plugins` array and `bun run prebuild`), so
// Hakka.show() opens the real inspector overlay here. That's different from
// the bare RN example, which never links native and always falls back to the
// warning path below.
function showInspector() {
  const handled = Hakka.show({ as: 'sheet' })
  if (!handled) {
    Alert.alert(
      'Native module not linked',
      'Run `npx expo prebuild --clean` and rebuild (`npx expo run:ios` / `run:android`) so the ' +
        'hakka-react-native config plugin can link the native module, then try again.',
    )
  }
}

function fireRequest(url: string) {
  fetch(url).catch(() => {
    // The point is to generate a captured request either way: a failed
    // fetch still shows up in the inspector as an error.
  })
}

export default function App() {
  const { totalCount } = useNetworkLogs()

  const onFireRequest = useCallback(() => fireRequest('https://httpbin.org/get'), [])
  const onFireFailingRequest = useCallback(() => fireRequest('https://httpstat.us/500'), [])

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      <View style={styles.content}>
        <Text style={styles.title}>Hakka + Expo</Text>
        <Text style={styles.subtitle}>
          Config-plugin managed native capture. Requests fire below; open the inspector to see them land.
        </Text>

        <Text style={styles.count}>{totalCount} captured</Text>

        <Pressable style={styles.button} onPress={onFireRequest}>
          <Text style={styles.buttonLabel}>Fire GET request</Text>
        </Pressable>

        <Pressable style={[styles.button, styles.buttonSecondary]} onPress={onFireFailingRequest}>
          <Text style={styles.buttonLabel}>Fire failing request</Text>
        </Pressable>

        <Pressable style={[styles.button, styles.buttonPrimary]} onPress={showInspector}>
          <Text style={styles.buttonLabel}>Open Hakka inspector</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 15,
    color: '#555',
  },
  count: {
    fontSize: 17,
    fontWeight: '600',
    marginVertical: 8,
  },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#222',
  },
  buttonSecondary: {
    backgroundColor: '#8a2b2b',
  },
  buttonPrimary: {
    backgroundColor: '#2b5f8a',
  },
  buttonLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
})
