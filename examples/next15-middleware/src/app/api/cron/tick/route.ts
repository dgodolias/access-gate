// Exempt via ACCESS_GATE_EXEMPT=/api/health,/api/cron/*. Cron routes carry their own auth.
export function GET() {
  return Response.json({ ok: true, job: "tick" });
}
