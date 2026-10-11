// Run the existing CLI command, including its mapper, bounded store, and exports.
import { runProxyCommand } from '../../packages/hakka-cli/src/proxyCommand'
await runProxyCommand(process.argv.slice(2))
