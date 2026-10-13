#!/usr/bin/env bash
# Encode a screen recording into the files the {{< video >}} shortcode expects:
#   static/video/<post-stem>/<name>-720.mp4   small (phones, slow connections)
#   static/video/<post-stem>/<name>-1080.mp4  sharp (desktop)
#   static/video/<post-stem>/<name>.jpg       poster frame
#
# Usage: scripts/encode_video.sh <input.mov> <post-stem> <name> [poster-seconds]
# Example: scripts/encode_video.sh ~/Desktop/rec.mov 2026-10-12-my-post ask-webgpu 3
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "usage: $0 <input> <post-stem> <name> [poster-seconds]" >&2
  exit 1
fi

in=$1
stem=$2
name=$3
poster_at=${4:-1}
out="static/video/$stem"
mkdir -p "$out"

# H.264 + yuv420p + faststart: plays everywhere and starts before it's fully downloaded.
# 30 fps is plenty for screen recordings; no audio track.
encode() {
  local width=$1 crf=$2 dest=$3
  ffmpeg -hide_banner -loglevel error -y -i "$in" \
    -vf "scale=${width}:-2,fps=30" \
    -c:v libx264 -preset slow -crf "$crf" -pix_fmt yuv420p \
    -an -movflags +faststart "$dest"
}

encode 1280 28 "$out/$name-720.mp4"
encode 1920 20 "$out/$name-1080.mp4"
ffmpeg -hide_banner -loglevel error -y -ss "$poster_at" -i "$in" \
  -vf "scale=1280:-2" -frames:v 1 -q:v 4 "$out/$name.jpg"

ls -lh "$out/$name"*
