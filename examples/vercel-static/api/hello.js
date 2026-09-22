// Vercel Node.js function using the Web signature (Request → Response).
export default function handler() {
  return Response.json({ ok: true, message: "hello from behind the gate" });
}
