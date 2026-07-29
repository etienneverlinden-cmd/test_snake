/**
 * Verify redirectTo handling for auth:signIn (Google) without completing OAuth.
 * Expectation: Convex must NOT throw "Invalid redirectTo".
 * A successful response includes a Google redirect URL (or fails later for other reasons).
 */
const CONVEX = "https://limitless-duck-213.convex.cloud";

async function tryRedirect(redirectTo) {
  const res = await fetch(`${CONVEX}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: "auth:signIn",
      args: {
        provider: "google",
        params: { redirectTo },
      },
      format: "json",
    }),
  });
  const data = await res.json();
  const err =
    data.errorMessage ||
    data.message ||
    (data.status === "error" ? JSON.stringify(data) : null);
  const ok = !err || !/Invalid `?redirectTo/i.test(String(err));
  console.log(
    JSON.stringify(
      {
        redirectTo,
        http: res.status,
        ok,
        error: err,
        hasRedirect: Boolean(data.value?.redirect || data.redirect),
      },
      null,
      2,
    ),
  );
  return ok;
}

const cases = [
  "index.html", // previously failing
  "/index.html", // docs-style
  "http://localhost:8080/index.html", // absolute SITE_URL
  "http://localhost:8080/",
];

let allOk = true;
for (const c of cases) {
  const ok = await tryRedirect(c);
  if (!ok) allOk = false;
}
process.exit(allOk ? 0 : 1);
