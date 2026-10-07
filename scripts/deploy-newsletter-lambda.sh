#!/bin/bash
# Deploy aws-lambda/newsletter.js to the cinemaroll-newsletter Lambda.
#
#   yarn deploy:newsletter
#
# The syntax check is the whole reason this is a script rather than three
# commands typed by hand. The prompt inside newsletter.js is a template
# literal, and prose about a `field` written with backticks terminates that
# literal — which shipped once (2026-09-20) and surfaced only as a 500 with
# `Runtime.UserCodeSyntaxError` in CloudWatch, after the upload. `node --check`
# catches it in a second, before anything leaves the machine.
#
# Run from the repo root: .tool-versions pins the awscli version there, and a
# scratch directory has none.
set -euo pipefail

FUNCTION=cinemaroll-newsletter
REGION=us-east-1
PROFILE=personal
# The aws on PATH is an Intel build on this Mac and dies with "Bad CPU type";
# scripts/deploy.mjs makes the same choice (2026-09-27).
AWS="${AWS_BIN:-$HOME/aws-cli/aws}"
[ -x "$AWS" ] || AWS=aws
BUNDLE="${TMPDIR:-/tmp}/cinemaroll-newsletter-bundle"

for file in aws-lambda/newsletter.js aws-lambda/newsletterCompose.js aws-lambda/newsletterSources.js aws-lambda/letterboxd.js aws-lambda/letterboxdSync.js; do
  node --check "$file" || { echo "✗ $file does not parse — nothing deployed."; exit 1; }
done
echo "✓ all five sources parse"

# The dependency tree is expensive to rebuild and never changes between code
# edits, so it is installed once and reused.
if [ ! -d "$BUNDLE/node_modules" ]; then
  echo "Installing dependencies into ${BUNDLE} ..."
  mkdir -p "$BUNDLE"
  cat > "$BUNDLE/package.json" <<'JSON'
{
  "name": "cinemaroll-newsletter-lambda",
  "version": "1.0.0",
  "main": "index.js",
  "dependencies": {
    "@anthropic-ai/sdk": "^0.39.0",
    "@aws-sdk/client-lambda": "^3.0.0",
    "web-push": "^3.6.7"
  }
}
JSON
  (cd "$BUNDLE" && npm install --omit=dev --no-audit --no-fund >/dev/null)
fi

cp aws-lambda/newsletter.js "$BUNDLE/index.js"
cp aws-lambda/newsletterCompose.js aws-lambda/newsletterSources.js aws-lambda/letterboxd.js aws-lambda/letterboxdSync.js aws-lambda/cinemaScore.js "$BUNDLE/"

# One more check, on the bundle itself: what parses in the repo is not
# necessarily what got copied.
(cd "$BUNDLE" && node --check index.js) || { echo "✗ the bundled index.js does not parse."; exit 1; }

rm -f "$BUNDLE/function.zip"
(cd "$BUNDLE" && zip -q -r function.zip . -x 'function.zip')
# A healthy bundle is a few MB (node_modules included; 4.6 MB on 2026-10-07). A small one means the
# bundle dir held hollow node_modules — it shipped that way once and broke a
# Friday issue (2026-10-07: 236 KB). Refuse, and say what to do.
ZIP_BYTES=$(stat -f%z "$BUNDLE/function.zip" 2>/dev/null || stat -c%s "$BUNDLE/function.zip")
if [ "$ZIP_BYTES" -lt 2000000 ]; then
  echo "✗ function.zip is only $ZIP_BYTES bytes — hollow node_modules. Run: rm -rf \"$BUNDLE\" && yarn deploy:newsletter"
  exit 1
fi
# And the modules the sources require must all be in the bundle.
(cd "$BUNDLE" && node -e "require('./newsletterSources.js'); require('./newsletterCompose.js')") || { echo "✗ the bundled sources do not load."; exit 1; }

"$AWS" lambda update-function-code \
  --function-name "$FUNCTION" \
  --zip-file "fileb://$BUNDLE/function.zip" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'LastUpdateStatus' --output text

for _ in $(seq 1 20); do
  status=$("$AWS" lambda get-function-configuration --function-name "$FUNCTION" \
    --profile "$PROFILE" --region "$REGION" --query 'LastUpdateStatus' --output text)
  if [ "$status" = "Successful" ]; then echo "✓ $FUNCTION updated"; exit 0; fi
  if [ "$status" = "Failed" ]; then echo "✗ update failed"; exit 1; fi
done
echo "! still updating — check the console"
