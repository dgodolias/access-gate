// Vercel routing proxy for a plain project (static files in public/ + api/ functions).
// Wired through "proxy": { "entrypoint": "proxy.ts" } in vercel.json.
export { default } from "@dgodolias/access-gate/vercel";
