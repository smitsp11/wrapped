#!/bin/sh
# Builds one release, without uploading or deploying anything:
#   release/  both Mac programs as .tar.gz plus their .sha256 files, for GitHub Releases
#   deploy/   the small website: the pages, vercel.json and an install.sh pinned to this version
# It prints the commands that publish them at the end.
set -eu

VERSION="$(node -p "require('./package.json').version")"
TAG="v$VERSION"

if [ -n "$(git status --porcelain)" ]; then
  echo "Warning: this folder has uncommitted changes, so the build won't match any commit." >&2
fi

rm -rf release
# Empty deploy/ but keep deploy/.vercel, the Vercel project link, so every deploy goes to the same project.
mkdir -p deploy
find deploy -mindepth 1 -maxdepth 1 ! -name .vercel -exec rm -rf {} +

npx vite build web
for ARCH in arm64 x64; do
  NAME="wrapped-darwin-$ARCH"
  bun build --compile --target="bun-darwin-$ARCH" src/app/main.ts --asset web/dist --outfile "release/$NAME"
  tar -czf "release/$NAME.tar.gz" -C release "$NAME"
  (cd release && shasum -a 256 "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
done

# The program prints the version inlined from package.json. Check it with the build this Mac can run.
NATIVE=arm64
if [ "$(uname -m)" = x86_64 ]; then NATIVE=x64; fi
BUILT="$("release/wrapped-darwin-$NATIVE" --version < /dev/null)"
if [ "$BUILT" != "$VERSION" ]; then
  echo "release.sh: the program says it is $BUILT, but package.json says $VERSION." >&2
  exit 1
fi

cp -R web/dist/. deploy/
# No file at "/": vercel.json rewrites "/" (curl gets install.sh, browsers get home.html), and files win over rewrites.
mv deploy/index.html deploy/home.html
cp site/vercel.json deploy/
sh scripts/pin-installer.sh "$VERSION" > deploy/install.sh
# The program checks this on start to say when there's an update (src/app/update.ts).
printf '{"version":"%s"}\n' "$VERSION" > deploy/version.json

du -sh release/*.tar.gz deploy

# A version with a dash (0.2.0-beta.1) is a prerelease on GitHub. The installer names the tag, so that's fine.
PRERELEASE=""
case "$VERSION" in
  *-*) PRERELEASE=" --prerelease" ;;
esac

cat <<EOF

Built $TAG from commit $(git rev-parse --short HEAD). Nothing was uploaded or deployed.
Next, in this order (the site's install.sh downloads from the GitHub release, so the release must exist first):

  sh scripts/publish-public.sh            # (workshop repo only) puts this source into smitsp11/wrapped; push as it says

  gh release create $TAG release/*.tar.gz release/*.sha256 --repo smitsp11/wrapped --target main$PRERELEASE --title "iMessage Wrapped $TAG" --notes "Install on a Mac: curl -fsSL https://wrapped.smitpatel.xyz | sh"

  vercel deploy deploy --prod
EOF
