const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;
const CORS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS"
};

exports.handler = async (event) => {
  // --- Handle CORS preflight (OPTIONS) ---
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    };
  }

  // --- Main POST logic ---
  const b = JSON.parse(event.body || "{}");
  const route = b.route;
  const stop = b.stop;
  const busId = b.bus_id || null;
  const source = b.source || "rider"; // "driver" | "rider"
  const level = Number(b.level); // 1..4
  const headcount = b.headcount != null ? Number(b.headcount) : null;

  const now = new Date();
  const iso = now.toISOString();
  const dow = now.getUTCDay(); // 0=Sunday..6=Saturday

  const item = {
    PK: `REPORT#${route}#${stop}`,
    SK: iso,
    route,
    stop,
    bus_id: busId,
    source,
    level,
    created_at: iso,
    dow,
  };
  if (headcount != null) item.headcount = headcount;

  await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    },
    body: JSON.stringify({ ok: true, saved_at: now.toISOString() }),
  };
};
