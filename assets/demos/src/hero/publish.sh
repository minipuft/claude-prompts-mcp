#!/usr/bin/env bash
# Upload a rendered demo to GitHub's user-attachments store, make it public, print the URL.
#
# A video only plays inline in a README when its src is a user-attachments URL: a
# repo-relative mp4 or a release asset renders as a download link. The web editor
# creates these URLs when a file is dragged into an issue; this script makes the
# same request with the OAuth token `gh` already holds, so the step is scripted
# rather than clicked. The endpoint is undocumented (protocol first written down
# by drogers0/gh-image, narrowed to the gh token by joseustra/gh-attach).
#
#   publish.sh --issue 523                      # uploads ../../hero-demo.mp4
#   publish.sh --issue 523 path/to/file.mp4     # any png/jpg/gif/webp/svg/mp4/mov/webm
#
# An uploaded asset is reachable only by the uploader until a posted issue or
# comment references it; a README referencing it is not enough (measured
# 2026-10-30: the README video 404'd for two days, and went public seconds after
# #523 quoted its URL). So the script posts the URL as a comment on --issue, then
# fetches it logged out and exits non-zero unless it serves. Needs push access to
# the repository. Re-running uploads a new asset: the URL is not tied to the file.
set -euo pipefail
HERO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ISSUE=""
if [ "${1:-}" = "--issue" ]; then ISSUE="${2:-}"; shift 2 || true; fi
[[ "$ISSUE" =~ ^[0-9]+$ ]] || { echo "publish.sh: --issue <number> is required: the asset stays private until a posted comment references it" >&2; exit 2; }
FILE="${1:-$HERO_DIR/../../hero-demo.mp4}"
[ -f "$FILE" ] || { echo "publish.sh: no such file: $FILE" >&2; exit 2; }

ext="${FILE##*.}"
case "${ext,,}" in
  png) type=image/png ;; jpg|jpeg) type=image/jpeg ;; gif) type=image/gif ;;
  webp) type=image/webp ;; svg) type=image/svg+xml ;;
  mp4) type=video/mp4 ;; mov) type=video/quicktime ;; webm) type=video/webm ;;
  *) echo "publish.sh: GitHub accepts images and video only, not .$ext" >&2; exit 2 ;;
esac

nwo="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
repo_id="$(gh api "repos/$nwo" -q .id 2>/dev/null || true)"   # the numeric id the upload endpoint wants
[ -n "$repo_id" ] || { echo "publish.sh: could not resolve the repository id (run inside the checkout, gh logged in)" >&2; exit 1; }
token="$(gh auth token --hostname github.com)"   # pinned: GH_HOST could otherwise hand an Enterprise token to uploads.github.com
[[ "$token" =~ ^[A-Za-z0-9_]+$ ]] || { echo "publish.sh: unexpected token format" >&2; exit 1; }

# The token travels in a curl config on stdin, never in argv (/proc/<pid>/cmdline is world-readable).
name="$(basename "$FILE")"
case "$FILE" in /*) upload="$FILE" ;; *) upload="./${FILE#./}" ;; esac   # a relative name must not read as a curl option
query="$(node -e 'const [n,t,r]=process.argv.slice(1);console.log(new URLSearchParams({name:n,content_type:t,repository_id:r}).toString())' "$name" "$type" "$repo_id")"
response="$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl -sS --fail-with-body -K - \
  --globoff -X POST -T "$upload" \
  -H "Content-Type: $type" -H "Accept: application/json" \
  "https://uploads.github.com/user-attachments/assets?$query" 2>&1)" || { echo "publish.sh: upload refused: $response" >&2; exit 1; }
url="$(printf '%s' "$response" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);if(!j.url)process.exit(1);console.log(j.url)})')"
# Referencing the URL in a posted comment is what makes the asset public.
gh issue comment "$ISSUE" --repo "$nwo" --body "Demo asset \`$name\`, published by \`assets/demos/src/hero/publish.sh\`:

$url" >/dev/null || { echo "publish.sh: uploaded $url but could not comment on #$ISSUE; it stays private until a posted comment references it" >&2; exit 1; }

# Fetch it the way a logged-out README visitor does: no token.
for _ in 1 2 3 4 5 6; do
  status="$(curl -s -o /dev/null -w '%{http_code}' -L "$url" || true)"
  [ "$status" = 200 ] && { echo "$url"; exit 0; }
  sleep 5
done
echo "publish.sh: $url still returns $status logged out after commenting on #$ISSUE; do not put it in the README" >&2
exit 1
