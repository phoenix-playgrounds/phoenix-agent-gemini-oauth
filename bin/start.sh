#!/bin/bash

if [ "$AGENT_PROVIDER" = "claude_code" ]; then
    eval $(dbus-launch --sh-syntax)
    export DBUS_SESSION_BUS_ADDRESS

    echo "" | gnome-keyring-daemon --unlock --start --components=secrets 2>/dev/null
    export GNOME_KEYRING_CONTROL
fi

exec node src/index.mjs
