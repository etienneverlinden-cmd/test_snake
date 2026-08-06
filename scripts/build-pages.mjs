/**
 * Build a Cloudflare Pages-ready static tree in ./dist
 * Mirrors deploy/auto-deploy.sh rsync excludes so backend/tooling never ships.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "dist");

const SKIP_DIRS = new Set([
  ".git",
  ".convex",
  "deploy",
  "node_modules",
  "convex",
  "dist",
  "docs",
  "scripts",
  ".cursor",
  ".vscode",
  ".idea",
]);

const SKIP_FILES = new Set([
  "package.json",
  "package-lock.json",
  ".gitignore",
  ".gitattributes",
  ".npmrc",
  ".env",
  ".env.example",
  "CONVEX.md",
  "AUTH.md",
  "README.md",
  "wrangler.toml",
  "Passcodes ms.docx",
]);

const SKIP_PREFIXES = [".env"];

function shouldSkip(relPosix) {
  const parts = relPosix.split("/");
  if (parts.some((p) => SKIP_DIRS.has(p))) return true;
  // test/ backend package (keep test/*.html + css/js)
  if (relPosix === "test/package.json") return true;
  if (relPosix === "test/package-lock.json") return true;
  if (relPosix === "test/tsconfig.json") return true;
  if (relPosix === "test/README.md") return true;
  if (relPosix === "test/.gitignore") return true;
  if (relPosix.startsWith("test/convex/")) return true;
  if (relPosix.startsWith("test/node_modules/")) return true;
  if (relPosix.startsWith("test/.env")) return true;
  const base = parts[parts.length - 1];
  if (SKIP_FILES.has(base)) return true;
  if (SKIP_PREFIXES.some((p) => base.startsWith(p))) return true;
  if (base.endsWith(".md") && !relPosix.startsWith("test/")) return true;
  if (base.endsWith(".ts") && !relPosix.includes("/js/")) return true;
  if (base.endsWith(".py") || base.endsWith(".sh") || base.endsWith(".mjs")) {
    return true;
  }
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

function writePagesFiles() {
  // Security / caching headers for Pages
  fs.writeFileSync(
    path.join(OUT, "_headers"),
    `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin

/*.html
  Cache-Control: public, max-age=0, must-revalidate

/assets/*
  Cache-Control: public, max-age=604800, immutable

/*.css
  Cache-Control: public, max-age=3600

/*.js
  Cache-Control: public, max-age=3600
`,
  );

  // Keep /test/ working as a directory index
  fs.writeFileSync(
    path.join(OUT, "_redirects"),
    `/test /test/index.html 200
`,
  );
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
copyTree(ROOT);
writePagesFiles();

const count = walkCount(OUT);
console.log(`Cloudflare Pages dist ready: ${count} files → ${OUT}`);

function walkCount(dir) {
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) n += walkCount(p);
    else n += 1;
  }
  return n;
}
