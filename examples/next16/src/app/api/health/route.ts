// Exempt via ACCESS_GATE_EXEMPT=/api/health,/api/cron/* so uptime monitors keep working.
export function GET() {
  return Response.json({ ok: true, status: "healthy" });
}
