#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <win-x64|osx-x64|osx-arm64>" >&2
  exit 64
fi

rid="$1"
case "$rid" in
  win-x64|osx-x64|osx-arm64) ;;
  *)
    echo "unsupported native runtime: $rid" >&2
    exit 64
    ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
artifact="$root/native/artifacts/$rid"
staging="$root/native/artifacts/.staging-$rid"
app_project="$root/native/CodexNative/CodexNative.csproj"
host_project="$root/native/CodexNative.TerminalHost/CodexNative.TerminalHost.csproj"

rm -rf "$artifact" "$staging"
mkdir -p "$staging/app" "$staging/host"

publish_args=(
  -c Release
  -r "$rid"
  --self-contained true
  -p:PublishSingleFile=true
  -p:IncludeNativeLibrariesForSelfExtract=true
  -p:EnableCompressionInSingleFile=true
)

dotnet publish "$app_project" "${publish_args[@]}" -o "$staging/app"
dotnet publish "$host_project" "${publish_args[@]}" -o "$staging/host"

if [[ "$rid" == osx-* ]]; then
  contents="$artifact/CodexNative.app/Contents"
  mkdir -p "$contents/MacOS" "$contents/Resources"
  install -m 0755 "$staging/app/CodexNative" "$contents/MacOS/CodexNative"
  install -m 0755 "$staging/host/CodexNative.TerminalHost" "$contents/MacOS/CodexNative.TerminalHost"
  install -m 0644 "$root/native/CodexNative/Assets/codex-native-icon.png" "$contents/Resources/codex-native-icon.png"

  version="$(sed -n 's:.*<Version>\([^<]*\)</Version>.*:\1:p' "$root/Directory.Build.props" | head -1)"
  arch="${rid#osx-}"
  sed -e "s/@VERSION@/$version/g" -e "s/@ARCH@/$arch/g" \
    "$root/native/CodexNative/Assets/Info.plist.in" > "$contents/Info.plist"

  if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1; then
    iconset="$staging/CodexNative.iconset"
    mkdir -p "$iconset"
    for size in 16 32 128 256 512; do
      sips -z "$size" "$size" "$root/native/CodexNative/Assets/codex-native-icon.png" \
        --out "$iconset/icon_${size}x${size}.png" >/dev/null
      double=$((size * 2))
      sips -z "$double" "$double" "$root/native/CodexNative/Assets/codex-native-icon.png" \
        --out "$iconset/icon_${size}x${size}@2x.png" >/dev/null
    done
    iconutil -c icns "$iconset" -o "$contents/Resources/CodexNative.icns"
  fi
else
  mkdir -p "$artifact"
  install -m 0755 "$staging/app/CodexNative.exe" "$artifact/CodexNative.exe"
  install -m 0755 "$staging/host/CodexNative.TerminalHost.exe" "$artifact/CodexNative.TerminalHost.exe"
  find "$staging/app" -maxdepth 1 -type f -name '*.pdb' -exec install -m 0644 {} "$artifact" \;
  find "$staging/host" -maxdepth 1 -type f -name '*.pdb' -exec install -m 0644 {} "$artifact" \;
fi

rm -rf "$staging"
echo "Native artifact ready: $artifact"
