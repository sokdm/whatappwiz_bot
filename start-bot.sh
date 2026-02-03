#!/data/data/com.termux/files/usr/bin/bash

# Keep CPU awake
termux-wake-lock

# Infinite loop to auto-restart bot if it crashes or disconnects
while true; do
    clear
    echo "🚀 Starting Mr Wisdom Bot..."
    node bot.js
    echo "❌ Bot crashed or disconnected, restarting in 5 seconds..."
    sleep 5
done
