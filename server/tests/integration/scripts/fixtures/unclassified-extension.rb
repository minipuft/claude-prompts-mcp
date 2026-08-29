#!/usr/bin/env ruby
# Deliberately NOT a runtime this repository maps. The body is valid `sh` so the
# arm asserting an explicit `runtime: shell` runs it can observe a real result —
# a fixture that could not run either way would make both arms look identical.
cat > /dev/null
printf '{"ranAs":"shell"}'
