/**
 * Build Cloudflare Pages dist for loic-kine.be
 * Publishes static files from test/ at the site root (no /test prefix).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SRC = path.join(ROOT, "test");
const OUT = path.join(ROOT, "dist");

const SKIP_DIRS = new Set([
  "convex",
  "node_modules",
  ".convex",
]);

const SKIP_FILES = new Set([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "README.md",
  ".gitignore",
  ".env",
  ".env.local",
]);

function shouldSkip(relPosix) {
  const parts = relPosix.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  const base = parts[parts.length - 1];
  if (SKIP_FILES.has(base)) return true;
  if (base.startsWith(".env")) return true;
  return false;
}

function copyTree(srcDir, rel = "") {
  for (const name of fs.readdirSync(srcDir)) {
    const abs = path.join(srcDir, name);
    const relPath = rel ? `${rel}/${name}` : name;
    const relPosix = relPath.replace(/\\/g, "/");
    if (shouldSkip(relPosix)) continue;
    const st = fs.statSync(abs);
    if (st.isDirectory()) {
      copyTree(abs, relPath);
      continue;
    }
    const dest = path.join(OUT, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyTree(SRC);

fs.writeFileSync(
  path.join(OUT, "_headers"),
  `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/css/*
  Cache-Control: public, max-age=3600

/js/*
  Cache-Control: public, max-age=3600
`,
);

let count = 0;
function walk(dir) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p);
    else count += 1;
  }
}
walk(OUT);
console.log(`loic-kine Pages dist ready: ${count} files → ${OUT}`);
