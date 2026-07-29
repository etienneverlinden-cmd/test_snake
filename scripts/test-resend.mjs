const key = process.env.AUTH_RESEND_KEY;
if (!key) {
  console.error("FAIL: no AUTH_RESEND_KEY in process env for this script");
  process.exit(1);
}

const to = process.argv[2] || "etienne.verlinden@gmail.com";
const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: "Stijn Arcade <onboarding@resend.dev>",
    to: [to],
    subject: "Stijn Arcade verification test",
    text: "If you received this, Resend can deliver to this address. Code test: 12345678",
  }),
});

const body = await res.text();
console.log("status", res.status);
console.log(body);
process.exit(res.ok ? 0 : 1);
