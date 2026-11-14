#!/bin/sh
# A successful request AND exactly HTTP 200 are required. Never follow redirects.
set -eu
status=$(curl --disable --silent --output /dev/null --write-out '%{http_code}' \
    --max-time 3 --noproxy '*' --proto '=http' \
    http://127.0.0.1:3000/_health) || exit 1
[ "$status" = 200 ]
