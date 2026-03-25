#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Upload one photo to R2 in two variants:
  1) Original quality at /photo/<name>.jpg
  2) Optimized gallery variant at /photo-1080/<name>.jpg

Usage:
  scripts/photo-upload.sh <input-file> <name> [options]

Examples:
  scripts/photo-upload.sh ~/Downloads/cat.jpg img-31
  scripts/photo-upload.sh ./frame.png img-32 --overwrite

Options:
  --remote <remote>         Rclone remote bucket path (default: r2:photos)
  --max-width <px>          Max width for optimized variant (default: 1080)
  --max-height <px>         Max height for optimized variant (default: 1350)
  --quality <1-100>         JPEG quality for optimized variant (default: 72)
  --source-quality <1-100>  JPEG quality when source must be converted (default: 92)
  --overwrite               Replace existing objects if they already exist
  -h, --help                Show this help

Notes:
  - Output object names are always JPG.
  - If immutable caching is enabled, prefer new names (img-33, img-34, ...) over overwrite.
EOF
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

to_lower() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

is_integer() {
  [[ "$1" =~ ^[0-9]+$ ]]
}

remote_has_object() {
  local remote_base="$1"
  local folder="$2"
  local object_name="$3"

  rclone lsf "${remote_base%/}/${folder}" --files-only 2>/dev/null | grep -Fxq "$object_name"
}

input_file="${1:-}"
name_arg="${2:-}"

if [[ -z "$input_file" || -z "$name_arg" ]]; then
  usage
  exit 1
fi

shift 2

remote_base="${R2_PHOTO_REMOTE:-r2:photos}"
max_width=1080
max_height=1350
quality=72
source_quality=92
overwrite=false

while (($# > 0)); do
  case "$1" in
    --remote)
      remote_base="${2:-}"
      shift 2
      ;;
    --max-width)
      max_width="${2:-}"
      shift 2
      ;;
    --max-height)
      max_height="${2:-}"
      shift 2
      ;;
    --quality)
      quality="${2:-}"
      shift 2
      ;;
    --source-quality)
      source_quality="${2:-}"
      shift 2
      ;;
    --overwrite)
      overwrite=true
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd sips
require_cmd rclone

if [[ ! -f "$input_file" ]]; then
  echo "Input file not found: $input_file" >&2
  exit 1
fi

if ! is_integer "$max_width" || ! is_integer "$max_height" || ! is_integer "$quality" || ! is_integer "$source_quality"; then
  echo "Width, height, and quality values must be integers." >&2
  exit 1
fi

if (( max_width < 64 || max_height < 64 )); then
  echo "max-width/max-height are too small. Use values >= 64." >&2
  exit 1
fi

if (( quality < 1 || quality > 100 || source_quality < 1 || source_quality > 100 )); then
  echo "Quality values must be between 1 and 100." >&2
  exit 1
fi

if [[ ! "$name_arg" =~ ^[A-Za-z0-9._-]+$ ]]; then
  echo "Invalid name: $name_arg" >&2
  echo "Allowed characters: letters, numbers, dot, underscore, dash." >&2
  exit 1
fi

object_name="$name_arg"
if [[ "$(to_lower "$object_name")" != *.jpg ]]; then
  object_name="${object_name}.jpg"
fi

if [[ "$overwrite" != "true" ]]; then
  if remote_has_object "$remote_base" "photo" "$object_name"; then
    echo "Object already exists: ${remote_base%/}/photo/$object_name" >&2
    echo "Use a new name or pass --overwrite." >&2
    exit 1
  fi

  if remote_has_object "$remote_base" "photo-1080" "$object_name"; then
    echo "Object already exists: ${remote_base%/}/photo-1080/$object_name" >&2
    echo "Use a new name or pass --overwrite." >&2
    exit 1
  fi
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

original_jpg="$tmp_dir/original.jpg"
optimized_jpg="$tmp_dir/optimized.jpg"

input_ext="$(to_lower "${input_file##*.}")"
if [[ "$input_ext" == "jpg" || "$input_ext" == "jpeg" ]]; then
  cp "$input_file" "$original_jpg"
else
  sips -s format jpeg -s formatOptions "$source_quality" "$input_file" --out "$original_jpg" >/dev/null
fi

sips -s format jpeg -s formatOptions "$quality" --resampleHeightWidthMax "$max_height" "$original_jpg" --out "$optimized_jpg" >/dev/null

current_width="$(sips -g pixelWidth "$optimized_jpg" | awk '/pixelWidth/ {print $2}')"
if [[ -n "$current_width" ]] && (( current_width > max_width )); then
  sips --resampleWidth "$max_width" "$optimized_jpg" >/dev/null
fi

original_bytes="$(wc -c < "$original_jpg" | tr -d ' ')"
optimized_bytes="$(wc -c < "$optimized_jpg" | tr -d ' ')"
optimized_dims="$(sips -g pixelWidth -g pixelHeight "$optimized_jpg" | awk '/pixelWidth|pixelHeight/ {printf "%s%s", (NR==1?"":"x"), $2} END {print ""}')"

rclone copyto "$original_jpg" "${remote_base%/}/photo/$object_name"
rclone copyto "$optimized_jpg" "${remote_base%/}/photo-1080/$object_name"

echo "Uploaded:"
echo "  ${remote_base%/}/photo/$object_name (${original_bytes} bytes)"
echo "  ${remote_base%/}/photo-1080/$object_name (${optimized_bytes} bytes, ${optimized_dims})"
echo "URLs:"
echo "  https://cdn.egeuysal.com/photo/$object_name"
echo "  https://cdn.egeuysal.com/photo-1080/$object_name"
