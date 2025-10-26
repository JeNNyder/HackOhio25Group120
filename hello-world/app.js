const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const TABLE = process.env.TABLE_NAME || "bus_app";
const CAP   = Number(process.env.CAPACITY || 60);

const levelToFrac = (lv) => ({ 1: 0.15, 2: 0.35, 3: 0.65, 4: 0.90 }[Number(lv)] ?? 0.35);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

exports.lambdaHandler = async (event) => {
  const q = event.queryStringParameters || {};
  const route = q.route || "CC";
  const stop  = q.stop  || "Union";
  const busId = q.bus_id || null;

  const atParam = q.at;
  const centerMs = atParam ? (isNaN(+atParam) ? Date.parse(atParam) : +atParam) : Date.now();
  const windowMin = Number(q.win || 15);
  const sinceIso = new Date(centerMs - windowMin * 60 * 1000).toISOString();
  const untilIso = new Date(centerMs + 1).toISOString(); // 右开区间，+1ms

  const { Items: reports = [] } = await ddb.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: "PK = :pk AND SK BETWEEN :since AND :until",
    ExpressionAttributeValues: {
      ":pk": `REPORT#${route}#${stop}`,
      ":since": sinceIso,
      ":until": untilIso
    }
  }));

  const mu0 = Number(process.env.PRIOR_MU0 ?? 0.35);
  const k0  = Number(process.env.PRIOR_K0  ?? 2);
  const tau = Number(process.env.TAU_MIN   ?? 10);   
  const wDriver = Number(process.env.W_DRIVER ?? 3);
  const wRider  = Number(process.env.W_RIDER  ?? 1);
  const outlierDelta = Number(process.env.OUTLIER_DELTA ?? 0.40);
  const busBonusCfg  = Number(process.env.BUS_BONUS ?? 1.5);

  let num = k0 * mu0, den = k0;
  let countDriver = 0, countRider = 0;

  for (const r of reports) {
    const ts = Date.parse(r.SK || r.created_at || 0);
    const minutesAgo = Math.max(0, (centerMs - ts) / 60000);
    const decay = Math.exp(-minutesAgo / tau);

    const base  = (r.source === "driver") ? wDriver : wRider;
    const busBonus = (busId && r.bus_id === busId) ? busBonusCfg : 1.0;

    const f = levelToFrac(r.level);
    let w = base * decay * busBonus;

    const muTmp = den ? num / den : mu0;
    if (Math.abs(f - muTmp) > outlierDelta) w *= 0.6;

    num += w * f; den += w;
    (r.source === "driver") ? countDriver++ : countRider++;
  }

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

  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      route, stop, bus_id: busId,
      level,
      est_headcount: est,
      headcount_ci68: ci68,
      remaining_capacity: remaining,
      confidence,
      counts: { reports: reports.length, driver: countDriver, rider: countRider },
      window_min: windowMin,
      ts: Date.now()
    })
  };
};
