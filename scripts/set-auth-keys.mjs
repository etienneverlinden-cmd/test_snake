import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { spawnSync } from "child_process";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey))
  .trimEnd()
  .replace(/\n/g, " ");
const publicKey = await exportJWK(keys.publicKey);
const jwks = JSON.stringify({ keys: [{ use: "sig", ...publicKey }] });

function setEnvViaStdin(name, value) {
  // Prefer stdin so spaces in PEM keys are not split by the shell.
  const result = spawnSync("npx", ["convex", "env", "set", name], {
    input: value,
    encoding: "utf8",
    shell: true,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

setEnvViaStdin("JWT_PRIVATE_KEY", privateKey);
setEnvViaStdin("JWKS", jwks);
console.log("Auth JWT keys set on Convex deployment.");
