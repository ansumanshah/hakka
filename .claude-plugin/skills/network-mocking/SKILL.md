# hakka-network-mocking

Configure Hakka mock rules in React Native to intercept and stub network requests — add rules, set responses with delay simulation, enable or disable rules at runtime, and throttle bandwidth for slow-network testing.

## Steps

1. Import the mock engine. Ensure `Hakka.start()` has already been called:

   ```ts
   import { mockEngine } from 'hakka-react-native'
   ```

   `mockEngine` is a singleton — no instantiation needed.

2. Add a mock rule:

   ```ts
   const ruleId = mockEngine.addRule({
     pattern: '/api/users', // string or RegExp
     method: 'GET', // optional — omit to match all methods
     response: {
       status: 200,
       body: { users: [] }, // object (serialized to JSON) or string
       headers: { 'x-source': 'mock' },
       delay: 200, // milliseconds
     },
   })
   ```

3. Enable or disable a rule at runtime without removing it:

   ```ts
   mockEngine.disableRule(ruleId)
   mockEngine.enableRule(ruleId)
   ```

4. Inspect, remove, or clear rules:

   ```ts
   mockEngine.getRules() // all rules
   mockEngine.match(url, method) // test if a URL+method would match
   mockEngine.removeRule(ruleId)
   mockEngine.clearRules()
   ```

5. Mock rules are automatically mirrored to the native module — both the JS and native capture layers see the same rule set.

6. Throttle bandwidth for slow-network testing (passes real requests through with simulated latency, does not stub responses):

   ```ts
   import { ThrottleEngine } from 'hakka-react-native'

   ThrottleEngine.setProfile('slow-3g') // 'none' | 'fast-3g' | 'slow-3g' | 'offline' | 'edge'
   ```

   To restore full speed:

   ```ts
   ThrottleEngine.setProfile('none')
   ```

7. Export captured requests (OpenTelemetry JSON format — no HAR export exists in v0.1.0):

   ```ts
   import { recordsToOtelJson } from 'hakka-react-native'

   const otelJson = recordsToOtelJson(Hakka.getLogs())
   ```

8. Monitor react-query cache activity alongside network requests:

   ```ts
   import { useQueryMonitor } from 'hakka-react-native/monitors'

   function Monitors() {
     useQueryMonitor([['users']], queryClient)
     return null
   }
   ```

   Mount `<Monitors />` inside your `QueryClientProvider`. The monitor surfaces cache hits, fetches, and stale revalidations in the Hakka inspector.
