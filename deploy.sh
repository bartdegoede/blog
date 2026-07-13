#!/bin/bash

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

# DRY_RUN=1 runs every check and the Hugo build, but never commits or pushes.
DRY_RUN="${DRY_RUN:-0}"

fail() {
    echo -e "${RED}$1${NC}" >&2
    exit 1
}

echo -e "${GREEN}Deploying updates to GitHub...${NC}"

# Check if public submodule is initialized (check for file or directory)
if [ ! -e "public/.git" ]; then
    echo -e "${YELLOW}Initializing public submodule...${NC}"
    git submodule update --init --recursive public
fi

# --- 1. Rebuild the search index ---------------------------------------------
#
# Artifact filenames carry a content hash, so an edited post produces new names.
# static/search/ is committed; a diff here means the repo and the site disagree.
echo -e "${GREEN}Building search index...${NC}"
uv run python scripts/build_search_index.py

if ! git diff --quiet --exit-code -- static/search || \
   [ -n "$(git ls-files --others --exclude-standard -- static/search)" ]; then
    echo -e "${RED}static/search/ changed when the index was rebuilt.${NC}" >&2
    git status --short -- static/search >&2
    fail "Commit the regenerated index before deploying, then re-run ./deploy.sh"
fi

# --- 2. Build the site --------------------------------------------------------
# NOTE: do NOT add --cleanDestinationDir here. public/ is a git submodule whose
# .git is a gitlink *file*, and cleanDestinationDir deletes it (along with any
# committed-but-not-regenerated file), breaking the submodule on every deploy.
# Orphaned old slugs are handled by `aliases:` front matter (which regenerates
# them as redirect stubs); public-only files like CNAME and BingSiteAuth.xml
# live in static/ so a normal build always re-emits them.
echo -e "${GREEN}Building site with Hugo...${NC}"
hugo

[ -d "public" ] || fail "Error: Hugo build failed - public directory not found"

# --- 3. Verify every indexed heading anchor exists in the rendered HTML --------
#
# Nothing reads chunks.json's `anchor` field at query time; it is indexed so that
# section-level deep links become a UI change later, with no re-embedding. Data
# that nothing reads rots quietly. This already caught one dead #fragment -- an
# `_emphasis_` heading -- that a narrower unit test happily passed.
echo -e "${GREEN}Verifying heading anchors against rendered HTML...${NC}"
uv run sss-eval verify-anchors --search-dir static/search --public public

# --- 4. Prove the browser reproduces Python's ranking --------------------------
#
# tests/js/parity.test.mjs pins the manifest's artifact filenames. If you added a
# post, the index legitimately changed and the fixture must be regenerated.
echo -e "${GREEN}Running JS tests (tokenizer, ranking, 40-case parity gate)...${NC}"
if ! node --test; then
    fail "JS tests failed. If only the parity gate's manifest check failed, run:
    uv run python scripts/gen_parity_fixture.py
and commit the regenerated tests/fixtures/parity.json"
fi

if [ "$DRY_RUN" = "1" ]; then
    echo -e "${YELLOW}DRY_RUN=1 -- all checks passed, skipping commit and push${NC}"
    exit 0
fi

# --- 5. Publish ---------------------------------------------------------------

# Go to Public folder (a separate git repository tracking the gh-pages master)
cd public

# Check for changes
if [ -z "$(git status --porcelain)" ]; then
    echo -e "${YELLOW}No changes to deploy${NC}"
    cd ..
    exit 0
fi

# Add changes to git
echo -e "${GREEN}Adding changes...${NC}"
git add .

# Commit changes
msg="rebuilding site $(date)"
if [ $# -eq 1 ]; then
    msg="$1"
fi
echo -e "${GREEN}Committing: $msg${NC}"
git commit -m "$msg"

# Push to GitHub Pages
echo -e "${GREEN}Pushing to GitHub Pages...${NC}"
git push origin master

# Come back to project root
cd ..

echo -e "${GREEN}✓ Deployment complete!${NC}"
echo -e "${CYAN}Your site should be live at: https://bart.degoe.de${NC}"
