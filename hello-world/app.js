// ---------- Import AWS SDK clients ----------
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ---------- Environment and constants ----------
const TABLE = process.env.TABLE_NAME || "bus_app";
const CAP   = Number(process.env.CAPACITY || 60);

// Map crowding level (1–4) to occupancy fraction (0–1)
const levelToFrac = (lv) => ({ 1: 0.15, 2: 0.35, 3: 0.65, 4: 0.90 }[Number(lv)] ?? 0.35);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// ---------- Dynamic prior: fetch same weekday past data ----------
const PRIOR_LOOKBACK_WEEKS = 4;   // how many weeks to look back
const PRIOR_HALF_WIN_MIN   = 30;  // ± window (minutes) for prior
const PRIOR_K_MAX          = 10;  // max prior strength
const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

async function computeWeekdayPrior(route, stop, centerMs) {
  const dowTarget = new Date(centerMs).getUTCDay(); // target weekday (0–6)
  const queries = [];

  // Query the same time window for the past N weeks
  for (let i = 1; i <= PRIOR_LOOKBACK_WEEKS; i++) {
    const refMs = centerMs - i * 7 * 24 * 60 * 60 * 1000;
    const since = new Date(refMs - PRIOR_HALF_WIN_MIN * 60 * 1000).toISOString();
    const until = new Date(refMs + PRIOR_HALF_WIN_MIN * 60 * 1000 + 1).toISOString();
    queries.push(ddb.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: "PK = :pk AND SK BETWEEN :since AND :until",
      ExpressionAttributeValues: {
        ":pk": `REPORT#${route}#${stop}`,
        ":since": since,
        ":until": until
      }
    })));
  }

  // Combine results
  const results = await Promise.all(queries);
  const all = results.flatMap(r => r.Items || []);

  // Filter records that match the same weekday
  const sameDow = all.filter(item => {
    const d = (item.dow != null) ? item.dow : new Date(item.SK || item.created_at).getUTCDay();
    return d === dowTarget;
  });

  // Default fallback if no historical data
  if (sameDow.length === 0) {
    return {
      mu0: Number(process.env.PRIOR_MU0 ?? 0.35),
      k0:  Number(process.env.PRIOR_K0  ?? 2)
    };
  }

  // Convert levels to fractions and compute mean
  const fs = sameDow.map(r => levelToFrac(r.level)).filter(Number.isFinite);
  if (fs.length === 0) {
    return {
      mu0: Number(process.env.PRIOR_MU0 ?? 0.35),
      k0:  Number(process.env.PRIOR_K0  ?? 2)
    };
  }

  const mu0 = fs.reduce((a, b) => a + b, 0) / fs.length;
  const k0  = Math.min(PRIOR_K_MAX, Math.max(2, fs.length)); // at least 2, cap at 10
  return { mu0, k0 };
}

// ---------- Main Lambda handler ----------
exports.lambdaHandler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  const q = event.queryStringParameters || {};
  const route = q.route || "CC";
  const stop  = q.stop  || "A";      // default stop
  const busId = q.bus_id || null;

  // ---- Time window: center and range (support ?at=ISO or milliseconds) ----
  const atParam  = q.at;
  const centerMs = atParam ? (isNaN(+atParam) ? Date.parse(atParam) : +atParam) : Date.now();
  const windowMin = Number(q.win || 15);
  const sinceIso = new Date(centerMs - windowMin * 60 * 1000).toISOString();
  const untilIso = new Date(centerMs + 1).toISOString(); // right-open boundary

  // ---- Compute weekday-based prior ----
  const { mu0, k0 } = await computeWeekdayPrior(route, stop, centerMs);

  // ---- Query real reports in current window ----
  const { Items: reports = [] } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :since AND :until",
    ExpressionAttributeValues: {
      ":pk": `REPORT#${route}#${stop}`,
      ":since": sinceIso,
      ":until": untilIso
    }
  }));

  // ---- Fusion parameters ----
  const tau      = Number(process.env.TAU_MIN        ?? 10);  // decay constant (min)
  const wDriver  = Number(process.env.W_DRIVER       ?? 3);   // driver weight
  const wRider   = Number(process.env.W_RIDER        ?? 1);   // rider weight
  const outDelta = Number(process.env.OUTLIER_DELTA  ?? 0.40);// outlier threshold
  const busBonus = Number(process.env.BUS_BONUS      ?? 1.5); // same bus bonus

  // ---- Weighted fusion ----
  let num = k0 * mu0, den = k0;
  let countDriver = 0, countRider = 0;

  for (const r of reports) {
    const ts = Date.parse(r.SK || r.created_at || 0);
    const minutesAgo = Math.max(0, (centerMs - ts) / 60000);
    const decay = Math.exp(-minutesAgo / tau); // time decay

    const base = (r.source === "driver") ? wDriver : wRider;
    const sameBusBonus = (busId && r.bus_id === busId) ? busBonus : 1.0;

    const f = levelToFrac(r.level);
    let w = base * decay * sameBusBonus;

    const muTmp = den ? (num / den) : mu0;
    if (Math.abs(f - muTmp) > outDelta) w *= 0.6; // soft outlier down-weight

    num += w * f; den += w;
    (r.source === "driver") ? countDriver++ : countRider++;
  }

  // ---- Compute results ----
  const mu = den ? clamp(num / den, 0, 1) : mu0;
  const est = Math.round(mu * CAP);
  const level = mu < 0.25 ? 1 : mu < 0.5 ? 2 : mu < 0.75 ? 3 : 4;
  const remaining = Math.max(0, CAP - est);

  const kEff = den;
  const confidence = kEff < 3 ? "low" : kEff < 6 ? "med" : "high";
  const sigma = Math.sqrt(mu * (1 - mu) / (kEff + 1));
  const ci68 = [
    Math.round(clamp(mu - sigma, 0, 1) * CAP),
    Math.round(clamp(mu + sigma, 0, 1) * CAP)
  ];

  // ---- Return response ----
  return {
    statusCode: 200,
    headers: CORS,
    headers: {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type"
    },
    body: JSON.stringify({
      route, stop, bus_id: busId,
      level,
      est_headcount: est,
      headcount_ci68: ci68,
      remaining_capacity: remaining,
      confidence,
      counts: { reports: reports.length, driver: countDriver, rider: countRider },
      window_min: windowMin,
      ts: Date.now(),
      prior: { mu0, k0 } // for debugging / observation
    })
  };
};
