#!/bin/sh
# Prints site/install.sh with its release filled in, so it downloads exactly that GitHub release.
# Usage: sh scripts/pin-installer.sh 0.2.0-beta.1 > deploy/install.sh
set -eu

VERSION="${1:-}"
case "$VERSION" in
  "" | *[!0-9A-Za-z.+-]*)
    echo "pin-installer.sh: \"$VERSION\" isn't a version like 0.2.0-beta.1" >&2
    exit 1
    ;;
esac

# Only the RELEASE="@VERSION@" line changes; the check further down that compares against the placeholder stays as it is.
PINNED="$(sed "s/^  RELEASE=\"@VERSION@\"\$/  RELEASE=\"$VERSION\"/" site/install.sh)"
if [ "$(printf '%s\n' "$PINNED" | grep -cxF "  RELEASE=\"$VERSION\"")" != 1 ]; then
  echo "pin-installer.sh: couldn't find the RELEASE=\"@VERSION@\" line in site/install.sh" >&2
  exit 1
fi
printf '%s\n' "$PINNED"
