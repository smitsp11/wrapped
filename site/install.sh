#!/bin/sh
# iMessage Wrapped installer. Downloads one program into ~/.imessage-wrapped and runs it.
# Read it before running it: https://wrapped.smitpatel.xyz/install.sh
#
# Everything lives inside main(), called on the last line, so a download that
# is cut off part-way is a syntax error and runs nothing.

main() {
  set -eu

  # The release this installer belongs to. scripts/release.sh writes the package.json version
  # here in the copy it deploys, so each installer downloads exactly one GitHub release.
  RELEASE="@VERSION@"
  # WRAPPED_DOWNLOAD lets the tests point at a local server instead of GitHub.
  DOWNLOAD="${WRAPPED_DOWNLOAD:-https://github.com/smitsp11/wrapped/releases/download/v$RELEASE}"
  APP_DIR="$HOME/.imessage-wrapped"
  BIN_DIR="$APP_DIR/bin"
  # src/app/shellStartup.ts looks for this mark (and these files) before the welcome says the line was added.
  MARK="# added by iMessage Wrapped"
  TMP=""
  trap 'rm -rf "${TMP:-}"' EXIT

  fail() {
    printf '%s\n' "$1" >&2
    exit 1
  }

  # -L follows GitHub's redirect from the release URL to the file itself.
  get() {
    case "$1" in
      https://*) curl --proto '=https' --tlsv1.2 -fsSL "$1" -o "$2" ;;
      *) curl -fsSL "$1" -o "$2" ;;
    esac
  }

  [ "$(uname -s)" = "Darwin" ] || fail "iMessage Wrapped only works on a Mac."
  # Only the copy on the website is tied to a release; the copy in the repo still has the placeholder.
  if [ "$RELEASE" = "@VERSION@" ] && [ -z "${WRAPPED_DOWNLOAD:-}" ]; then
    fail "This copy of install.sh isn't tied to a release. Install with:  curl -fsSL https://wrapped.smitpatel.xyz | sh"
  fi
  case "$(uname -m)" in
    arm64) ARCH=arm64 ;;
    x86_64) ARCH=x64 ;;
    *) fail "This Mac's processor ($(uname -m)) isn't supported." ;;
  esac
  # An Intel shell under Rosetta on Apple Silicon still gets the native build.
  if [ "$ARCH" = x64 ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || echo 0)" = 1 ]; then
    ARCH=arm64
  fi

  NAME="wrapped-darwin-$ARCH"
  NO_ACCESS="Couldn't install into ~/.imessage-wrapped. Check its permissions and try again."
  # The temp dir sits inside the app dir so the final mv is a same-volume rename.
  mkdir -p "$APP_DIR" && chmod 700 "$APP_DIR" && TMP="$(mktemp -d "$APP_DIR/.tmp.XXXXXX")" || fail "$NO_ACCESS"

  printf 'Downloading iMessage Wrapped…\n'
  get "$DOWNLOAD/$NAME.tar.gz" "$TMP/$NAME.tar.gz" || fail "Download failed, so nothing was installed. Check your internet and try again."
  get "$DOWNLOAD/$NAME.tar.gz.sha256" "$TMP/sum" || fail "Download failed, so nothing was installed. Check your internet and try again."
  # The checksum catches corrupt or cut-off downloads, not a compromised host.
  # Developer ID signing + notarization is the real fix, later.
  EXPECTED="$(cut -d ' ' -f 1 < "$TMP/sum" | tr 'A-F' 'a-f')"
  ACTUAL="$(shasum -a 256 "$TMP/$NAME.tar.gz" | cut -d ' ' -f 1)"
  case "$EXPECTED" in
    *[!0-9a-f]*) fail "The download didn't match its checksum, so nothing was installed. Try again." ;;
  esac
  [ "${#EXPECTED}" = 64 ] && [ "$EXPECTED" = "$ACTUAL" ] || fail "The download didn't match its checksum, so nothing was installed. Try again."

  (
    tar -xzf "$TMP/$NAME.tar.gz" -C "$TMP" &&
      mkdir -p "$BIN_DIR" &&
      [ ! -d "$BIN_DIR/wrapped" ] &&
      mv "$TMP/$NAME" "$BIN_DIR/wrapped" &&
      chmod 755 "$BIN_DIR/wrapped"
  ) || fail "$NO_ACCESS"

  # Put ~/.imessage-wrapped/bin on PATH once, so later runs are just `wrapped`.
  RC=""
  PATH_OK=""
  case "$(basename "${SHELL:-/bin/zsh}")" in
    zsh) RC="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      RC="$HOME/.bash_profile"
      for f in .bash_profile .bash_login .profile; do
        if [ -f "$HOME/$f" ]; then
          RC="$HOME/$f"
          break
        fi
      done
      ;;
    *) printf "Add this to your shell's PATH: %s\n" "$BIN_DIR" ;;
  esac
  if [ -n "$RC" ]; then
    if grep -qF "$MARK" "$RC" 2>/dev/null; then
      PATH_OK=1
    # shellcheck disable=SC2016 # $HOME and $PATH must stay literal in the shell settings file
    elif { printf '\nexport PATH="$HOME/.imessage-wrapped/bin:$PATH" %s\n' "$MARK" >> "$RC"; } 2>/dev/null; then
      PATH_OK=1
    else
      printf 'Could not update %s. Next time run: %s/wrapped\n' "$RC" "$BIN_DIR" >&2
    fi
  fi

  rm -rf "$TMP"
  trap - EXIT
  # Name the version in the message only if the program printed a plain one, like 0.1.0.
  VERSION="$("$BIN_DIR/wrapped" --version < /dev/null 2> /dev/null || true)"
  DONE="Installed."
  case "$VERSION" in
    *[!0-9A-Za-z.+-]*) ;;
    [0-9]*.[0-9]*) DONE="Installed iMessage Wrapped $VERSION." ;;
  esac
  if [ -n "$PATH_OK" ]; then
    printf '%s Next time, open a new Terminal window and type:  wrapped\n' "$DONE"
  else
    printf '%s Next time run:  %s/wrapped\n' "$DONE" "$BIN_DIR"
  fi
  [ "${WRAPPED_NO_RUN:-}" = 1 ] && exit 0
  # This script arrives through a pipe, so give the program the keyboard back.
  if (: < /dev/tty) 2>/dev/null; then
    exec "$BIN_DIR/wrapped" < /dev/tty
  else
    printf 'To start it now, run: %s/wrapped\n' "$BIN_DIR"
  fi
}

main "$@"
