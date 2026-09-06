# hakka-rozenite

Experimental Hakka panel for React Native DevTools through
[Rozenite](https://rozenite.dev). It uses the request list, detail, and filter
components from `hakka-browser/react`, fed by `hakka-react-native` captures.

## Setup

Configure Rozenite in the app's Metro/Re.Pack configuration, then install
`hakka-rozenite` alongside the matching `hakka-react-native` peer.

```tsx
import { useHakka } from 'hakka-react-native'
import { useHakkaRozeniteDevTools } from 'hakka-rozenite'

function App() {
  useHakka()
  useHakkaRozeniteDevTools()
  // Render your app.
}
```

The hook is inactive in production, web, and SSR. The
[React Native example](../../examples/react-native-example/) includes Metro
configuration and a `start:rozenite` script.

## Compatibility

The package uses the coordinated Rozenite 2.4.0 family and Vite 7.3.6.
Its plugin API remains experimental. Use the lockfile's coordinated versions
when updating Rozenite packages.

## Behavior and limits

- Requests travel through Rozenite messaging. No Hakka bridge hub is required.
- The panel requests a backlog on mount, then upserts live frames by request ID.
  Updates keep the original order; clearing propagates to the device.
- Inspection and export are available. Mock, throttle, and breakpoint controls
  are not wired into this panel.
- Each request uses one message frame. Sample traffic stays in the panel mirror.

[Full guide](https://hakka.noodleapps.com/embedding/rozenite/)
· [Transport and build verification](../../examples/rozenite/)
