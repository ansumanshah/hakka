#!/bin/sh
set -eu

checkout=$PWD
repository_root=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
cd "$repository_root"

exec "$checkout/node_modules/.bin/knip" --directory "$checkout" \
  --include files,exports,types,dependencies,devDependencies \
  --no-progress --treat-config-hints-as-errors
