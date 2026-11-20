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

  # Keep one line in the shell's startup file: it puts ~/.imessage-wrapped/bin on PATH, so later runs are
  # just `wrapped`, and picks up after "Quit & Reopen" (only while ~/.imessage-wrapped/resume exists; the
  # program checks the rest). src/app/shellStartup.ts has the same line as STARTUP_LINE; keep the two in sync.
  # shellcheck disable=SC2016 # $HOME and $PATH must stay literal in the shell settings file
  LINE='export PATH="$HOME/.imessage-wrapped/bin:$PATH"; if [ -f "$HOME/.imessage-wrapped/resume" ]; then "$HOME/.imessage-wrapped/bin/wrapped" --resume-check; fi '"$MARK"
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
    if [ "$(grep -cF "$MARK" "$RC" 2>/dev/null)" = 1 ] && grep -qxF "$LINE" "$RC"; then
      PATH_OK=1
    elif grep -qF "$MARK" "$RC" 2>/dev/null; then
      # An older install's line: swap in the current one where it is, and drop any extra copies. cat > keeps
      # the file itself (a symlink stays a symlink) and its permissions.
      if awk -v line="$LINE" -v mark="$MARK" 'index($0, mark) { if (!done) print line; done = 1; next } { print }' "$RC" > "$TMP/rc" 2>/dev/null &&
        [ -s "$TMP/rc" ] && { cat "$TMP/rc" > "$RC"; } 2>/dev/null; then
        PATH_OK=1
      else
        printf 'Could not update %s.\n' "$RC" >&2
      fi
    elif { printf '\n%s\n' "$LINE" >> "$RC"; } 2>/dev/null; then
      PATH_OK=1
    else
      printf 'Could not update %s.\n' "$RC" >&2
    fi
  fi

  rm -rf "$TMP"
  trap - EXIT
  # The full path only when the line couldn't be added; otherwise `wrapped` works next time by itself.
  if [ -n "$PATH_OK" ]; then
    DONE="Installed."
  else
    DONE="Installed. Next time run:  $BIN_DIR/wrapped"
  fi
  if [ "${WRAPPED_NO_RUN:-}" = 1 ]; then
    printf '%s\n' "$DONE"
    exit 0
  fi
  # This script arrives through a pipe, so give the program the keyboard back. Bun can't wait on a
  # freshly opened /dev/tty on macOS (kqueue says EINVAL), so script(1) gives it a terminal of its own
  # and passes the keys through.
  if (: < /dev/tty) 2>/dev/null; then
    if [ -n "$PATH_OK" ]; then
      printf 'Installed. Opening it…\n'
    else
      printf '%s\nOpening it…\n' "$DONE"
    fi
    exec script -q /dev/null "$BIN_DIR/wrapped" < /dev/tty
  else
    printf '%s\nTo start it now, run:  %s/wrapped\n' "$DONE" "$BIN_DIR"
  fi
}

main "$@"
