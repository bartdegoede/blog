// Compute Fuse.js keyword-search rankings for the parity fixture.
//
// Reads `public/index.json` (Hugo's search feed, same file the homepage
// fetches) and a JSON array of queries from stdin, and writes a JSON object
// mapping each query to its ranked list of post slugs on stdout.
//
// The Fuse config below is copy-pasted from
// layouts/partials/extend_footer.html -- keep it in sync by hand, this file
// does not import that template.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import Fuse from "fuse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexPath = path.join(__dirname, "..", "public", "index.json");

const data = JSON.parse(readFileSync(indexPath, "utf8"));

// Must match layouts/partials/extend_footer.html's fuseOptions exactly.
const fuseOptions = {
  isCaseSensitive: false,
  shouldSort: true,
  ignoreLocation: true,
  threshold: 0.2,
  minMatchCharLength: 2,
  keys: [
    { name: "title", weight: 0.8 },
    { name: "content", weight: 0.5 },
    { name: "categories", weight: 0.3 },
  ],
};

const fuse = new Fuse(data, fuseOptions);

function hrefToSlug(href) {
  return new URL(href).pathname.replace(/^\/+|\/+$/g, "");
}

const queries = JSON.parse(readFileSync(0, "utf8"));

const result = {};
for (const query of queries) {
  result[query] = fuse.search(query).map((hit) => hrefToSlug(hit.item.href));
}

process.stdout.write(JSON.stringify(result));
