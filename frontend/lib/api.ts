export const API_BASE = process.env.NEXT_PUBLIC_API_BASE!;

export async function fetchCrowdNow(params: {route: string; stop: string; bus_id?: string; win?: number}) {
  const url = new URL(`${API_BASE}/crowd/now`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));
  const r = await fetch(url.toString(), { cache: "no-store" });
  if (!r.ok) throw new Error(`crowd/now ${r.status}`);
  return r.json();
}

export async function postReport(body: {
  route: string; stop: string; source: "driver"|"rider"; level: number; headcount?: number; bus_id?: string
}) {
  const r = await fetch(`${API_BASE}/report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`report ${r.status}`);
  return r.json();
}
