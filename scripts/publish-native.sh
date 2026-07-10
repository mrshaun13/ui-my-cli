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
speech_project="$root/native/CodexNative.SpeechHost/CodexNative.SpeechHost.csproj"
speech_build="$root/native/CodexNative.SpeechHost/bin/Release/net10.0/$rid"
updater_project="$root/native/CodexNative.Updater/CodexNative.Updater.csproj"

rm -rf "$artifact" "$staging"
mkdir -p "$staging/app" "$staging/host" "$staging/speech" "$staging/updater"

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
dotnet publish "$speech_project" "${publish_args[@]}" -o "$staging/speech"
dotnet publish "$updater_project" "${publish_args[@]}" -o "$staging/updater"

if [[ "$rid" == osx-* ]]; then
  contents="$artifact/CodexNative.app/Contents"
  speech_runtime="macos-${rid#osx-}"
  mkdir -p "$contents/MacOS/runtimes/$speech_runtime" "$contents/Resources"
  install -m 0755 "$staging/app/CodexNative" "$contents/MacOS/CodexNative"
  install -m 0755 "$staging/host/CodexNative.TerminalHost" "$contents/MacOS/CodexNative.TerminalHost"
  install -m 0755 "$staging/speech/CodexNative.SpeechHost" "$contents/MacOS/CodexNative.SpeechHost"
  install -m 0755 "$staging/updater/CodexNative.Updater" "$contents/MacOS/CodexNative.Updater"
  install -m 0644 "$root/native/CodexNative/Assets/codex-native-icon.png" "$contents/Resources/codex-native-icon.png"
  install -m 0644 "$root/native/CodexNative/Assets/CodexNative.entitlements" "$contents/Resources/CodexNative.entitlements"
  install -m 0644 "$staging/speech/ggml-metal.metal" "$contents/MacOS/ggml-metal.metal"
  install -m 0644 "$speech_build/runtimes/$speech_runtime/"*.dylib \
    "$contents/MacOS/runtimes/$speech_runtime/"

  version="$(sed -n 's:.*<Version>\([^<]*\)</Version>.*:\1:p' "$root/Directory.Build.props" | head -1)"
  arch="${rid#osx-}"
  if [[ "$arch" == "x64" ]]; then
    arch="x86_64"
  fi
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
  mkdir -p "$artifact/runtimes/win-x64"
  install -m 0755 "$staging/app/CodexNative.exe" "$artifact/CodexNative.exe"
  install -m 0755 "$staging/host/CodexNative.TerminalHost.exe" "$artifact/CodexNative.TerminalHost.exe"
  install -m 0755 "$staging/speech/CodexNative.SpeechHost.exe" "$artifact/CodexNative.SpeechHost.exe"
  install -m 0755 "$staging/updater/CodexNative.Updater.exe" "$artifact/CodexNative.Updater.exe"
  install -m 0644 "$speech_build/runtimes/win-x64/"*.dll "$artifact/runtimes/win-x64/"
  find "$staging/app" -maxdepth 1 -type f -name '*.pdb' -exec install -m 0644 {} "$artifact" \;
  find "$staging/host" -maxdepth 1 -type f -name '*.pdb' -exec install -m 0644 {} "$artifact" \;
  find "$staging/speech" -maxdepth 1 -type f -name '*.pdb' -exec install -m 0644 {} "$artifact" \;
fi

rm -rf "$staging"
echo "Native artifact ready: $artifact"
