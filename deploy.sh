#!/bin/bash

set -e  # Exit on error

echo -e "\033[0;32mDeploying updates to GitHub...\033[0m"

# Check if public submodule is initialized
if [ ! -d "public/.git" ]; then
    echo -e "\033[0;33mInitializing public submodule...\033[0m"
    git submodule update --init --recursive public
fi

# Build the project
echo -e "\033[0;32mBuilding site with Hugo...\033[0m"
hugo

# Check if build was successful
if [ ! -d "public" ]; then
    echo -e "\033[0;31mError: Hugo build failed - public directory not found\033[0m"
    exit 1
fi

# Go to Public folder
cd public

# Check for changes
if [ -z "$(git status --porcelain)" ]; then
    echo -e "\033[0;33mNo changes to deploy\033[0m"
    cd ..
    exit 0
fi

# Add changes to git
echo -e "\033[0;32mAdding changes...\033[0m"
git add .

# Commit changes
msg="rebuilding site $(date)"
if [ $# -eq 1 ]; then
    msg="$1"
fi
echo -e "\033[0;32mCommitting: $msg\033[0m"
git commit -m "$msg"

# Push to GitHub Pages
echo -e "\033[0;32mPushing to GitHub Pages...\033[0m"
git push origin master

# Come back to project root
cd ..

echo -e "\033[0;32m✓ Deployment complete!\033[0m"
echo -e "\033[0;36mYour site should be live at: https://bart.degoe.de\033[0m"
