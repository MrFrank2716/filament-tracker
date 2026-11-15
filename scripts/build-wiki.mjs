#!/usr/bin/env node
// Copies docs/wiki into a folder laid out for the GitHub wiki, rewriting links on the way.
//
// The pages are written to work when browsed in the repository: links between pages end in .md,
// and links to other files climb out with ../../. The GitHub wiki wants page links without .md,
// and cannot see the repository's files, so those become full GitHub URLs. Images stay relative.
//
// Usage: node scripts/build-wiki.mjs <output folder>
// GITHUB_REPOSITORY (set by GitHub Actions) and WIKI_BRANCH choose where repository links point.

import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'docs', 'wiki');
const out = process.argv[2] ? resolve(process.argv[2]) : null;
if (!out) {
  console.error('Usage: node scripts/build-wiki.mjs <output folder>');
  process.exit(1);
}

const repo = process.env.GITHUB_REPOSITORY || 'hussxin5046/filament-tracker';
const branch = process.env.WIKI_BRANCH || 'main';
const repoUrl = `https://github.com/${repo}`;

/** Where a link inside a page should point once the page is in the wiki. */
export function rewriteTarget(target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return target;
  const [path, hash = ''] = target.split(/(?=#)/);
  const anchor = hash;
  if (!path.includes('/') && path.endsWith('.md')) return path.slice(0, -3) + anchor; // another page
  if (path.startsWith('images/')) return target; // copied alongside the pages
  // Anything else is a file in the repository, relative to docs/wiki.
  const inRepo = posix.normalize(posix.join('docs/wiki', path));
  if (inRepo.startsWith('..')) throw new Error(`Link leaves the repository: ${target}`);
  const isFolder = !posix.extname(inRepo) || statSync(join(root, inRepo), { throwIfNoEntry: false })?.isDirectory();
  return `${repoUrl}/${isFolder ? 'tree' : 'blob'}/${branch}/${inRepo}${anchor}`;
}

/** Rewrites Markdown links and images outside fenced code blocks. */
export function rewritePage(text) {
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/(!?\[[^\]]*\]\()([^)\s]+)(\))/g, (_, open, target, close) => open + rewriteTarget(target) + close);
    })
    .join('\n');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

let pages = 0;
for (const name of readdirSync(source)) {
  const from = join(source, name);
  if (statSync(from).isDirectory()) {
    cpSync(from, join(out, name), { recursive: true });
  } else if (name.endsWith('.md')) {
    writeFileSync(join(out, name), rewritePage(readFileSync(from, 'utf8')));
    pages += 1;
  }
}
console.log(`Wrote ${pages} pages to ${out} (links point at ${repoUrl}, branch ${branch})`);
