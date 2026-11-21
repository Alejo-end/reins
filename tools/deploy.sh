#!/bin/bash
# Builds the site for https://alejo-end.github.io/reins/ and publishes dist/ on the gh-pages
set -euo pipefail
cd "$(dirname "$0")/.."
BASE=/reins/ npm run build
cd dist
touch .nojekyll
rm -rf .git
git init -q -b gh-pages
git add -A
git commit -q -m "deploy $(git -C .. rev-parse --short HEAD)"
git push -q -f https://github.com/Alejo-end/reins.git gh-pages
rm -rf .git
echo "published: https://alejo-end.github.io/reins/"
