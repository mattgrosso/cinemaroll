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
BUNDLE="${TMPDIR:-/tmp}/cinemaroll-newsletter-bundle"

for file in aws-lambda/newsletter.js aws-lambda/newsletterCompose.js aws-lambda/newsletterSources.js; do
  node --check "$file" || { echo "✗ $file does not parse — nothing deployed."; exit 1; }
done
echo "✓ all three sources parse"

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
cp aws-lambda/newsletterCompose.js aws-lambda/newsletterSources.js "$BUNDLE/"

# One more check, on the bundle itself: what parses in the repo is not
# necessarily what got copied.
(cd "$BUNDLE" && node --check index.js) || { echo "✗ the bundled index.js does not parse."; exit 1; }

rm -f "$BUNDLE/function.zip"
(cd "$BUNDLE" && zip -q -r function.zip . -x 'function.zip')

aws lambda update-function-code \
  --function-name "$FUNCTION" \
  --zip-file "fileb://$BUNDLE/function.zip" \
  --profile "$PROFILE" --region "$REGION" \
  --query 'LastUpdateStatus' --output text

for _ in $(seq 1 20); do
  status=$(aws lambda get-function-configuration --function-name "$FUNCTION" \
    --profile "$PROFILE" --region "$REGION" --query 'LastUpdateStatus' --output text)
  if [ "$status" = "Successful" ]; then echo "✓ $FUNCTION updated"; exit 0; fi
  if [ "$status" = "Failed" ]; then echo "✗ update failed"; exit 1; fi
done
echo "! still updating — check the console"
