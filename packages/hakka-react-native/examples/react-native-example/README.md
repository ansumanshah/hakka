# react-native-example

Local dev harness for testing `hakka-react-native` against the native Android and iOS SDKs.

## Run

From the repository root:

```bash
bun run dev:rn:ios
bun run dev:rn:android
```

From this directory:

```bash
npx expo run:ios
npx expo run:android
```

## What it covers

- All capture modes: `native`, `js`, `auto`, `disabled`
- `HakkaInspector.Wrapper` with `mode="bubble"` and `mode="panel"`
- `useQueryMonitor`, `AsyncStorage`, and `MMKV` monitors
- Desktop streaming to Hakka on port 8989
- Localhost bridge traffic exclusion (self-capture prevention)
