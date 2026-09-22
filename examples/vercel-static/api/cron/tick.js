// Exempt via ACCESS_GATE_EXEMPT=/api/health,/api/cron/*. Cron routes carry their own auth.
export default function handler() {
  return Response.json({ ok: true, job: "tick" });
}
