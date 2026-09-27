#!/bin/sh
# Keep the Electron debugger's library path identical for Expo and the workspace check.
export LD_LIBRARY_PATH="${REPLIT_LD_LIBRARY_PATH}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
exec "$@"