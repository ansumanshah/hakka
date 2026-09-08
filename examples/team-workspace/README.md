# Team workspace

This directory demonstrates a canonical collection workspace suitable for `hakka team push` and `hakka team pull`.

```sh
hakka team serve --data .hakka/team-state.json --token "$HAKKA_TEAM_BOOTSTRAP_TOKEN"
hakka team push . --url http://127.0.0.1:7137 --token "$HAKKA_TEAM_TOKEN"
```

The service is intended for a private network behind TLS and a reverse proxy. Do not publish the local URL.
