const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand } = require("@aws-sdk/lib-dynamodb");
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const TABLE = process.env.TABLE_NAME;

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
    const { route, stop, bus_id, source, level, headcount } = body;

    // Basic validation
    if (!route || !stop || !level) {
      return { statusCode: 400, body: "missing route|stop|level" };
    }

    const now = new Date().toISOString();
    const item = {
      PK: `REPORT#${route}#${stop}`,
      SK: now,
      route,
      stop,
      bus_id: bus_id || null,
      source: source || "rider", // 'driver' or 'rider'
      level,
      headcount: headcount ?? null,
      created_at: now
    };

    await ddb.send(new PutCommand({ TableName: TABLE, Item: item }));

    return {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true, saved_at: now })
    };
  } catch (err) {
    console.error("Error:", err);
    return { statusCode: 500, body: err.message || "error" };
  }
};
