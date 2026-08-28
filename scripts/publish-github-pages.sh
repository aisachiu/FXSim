#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "GITHUB_TOKEN is not set in this environment."
  echo "Add it to your Cursor environment secrets and restart the agent."
  exit 1
fi

REPO_NAME="${1:-FXSim}"
GITHUB_USER="$(curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user | python3 -c 'import sys,json; print(json.load(sys.stdin)["login"])')"

echo "Authenticated as ${GITHUB_USER}"

if ! curl -fsSL -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}" | grep -q '^200$'; then
  echo "Creating repository ${GITHUB_USER}/${REPO_NAME}..."
  curl -fsSL -X POST \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    https://api.github.com/user/repos \
    -d "{\"name\":\"${REPO_NAME}\",\"description\":\"Paper currency trading simulator (HKD)\",\"private\":false,\"auto_init\":false}" \
    > /dev/null
else
  echo "Repository ${GITHUB_USER}/${REPO_NAME} already exists."
fi

git remote remove origin 2>/dev/null || true
git remote add origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_USER}/${REPO_NAME}.git"

git push -u origin main

echo "Enabling GitHub Pages (GitHub Actions source)..."
curl -fsSL -X POST \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${GITHUB_USER}/${REPO_NAME}/pages" \
  -d '{"build_type":"workflow"}' > /dev/null || true

PAGES_URL="https://${GITHUB_USER}.github.io/${REPO_NAME}/"
echo ""
echo "Pushed to https://github.com/${GITHUB_USER}/${REPO_NAME}"
echo "Pages URL (after workflow completes): ${PAGES_URL}"
