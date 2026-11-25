#!/usr/bin/env bash
# Wraps `tauri android <cmd>` with the toolchain env vars it needs.
# Override any of them by exporting before running.
set -euo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
if [[ -z "${JAVA_HOME:-}" ]]; then
  for candidate in "$HOME"/.local/jdk/jdk-21* "$HOME"/.local/jdk17 /usr/lib/jvm/java-21-openjdk* /usr/lib/jvm/java-17-openjdk*; do
    [[ -x "$candidate/bin/javac" ]] && export JAVA_HOME="$candidate" && break
  done
fi
if [[ -z "${NDK_HOME:-}" ]]; then
  NDK_HOME="$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1)"
  export NDK_HOME
fi

: "${JAVA_HOME:?JDK not found — set JAVA_HOME}"
: "${NDK_HOME:?Android NDK not found — install it via sdkmanager and/or set NDK_HOME}"
export PATH="$JAVA_HOME/bin:$PATH"

cd "$(dirname "$0")/.."
exec npx tauri android "$@"
