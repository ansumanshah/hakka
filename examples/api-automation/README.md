# API automation

From the repository root, build the packages and run the local demo:

```sh
bun run build
node examples/api-automation/run.mjs
```

The demo starts a temporary loopback API, runs the saved collection through the built
CLI, and closes the server. It creates a user, captures the response ID, and uses it
in the second request. Standard output is one JSON report; failures exit nonzero.
It does not call a public API.

Open this directory as a collection in the desktop app, or point it at your own
matching API with `hakka run examples/api-automation --env BASE_URL=http://localhost:3000 --json`.
See the [collection runner guide](https://hakka.noodleapps.com/testing/collection-runner/)
for datasets and JUnit reports.
