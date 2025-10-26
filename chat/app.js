// chat/app.js
// Orchestrate: parse user ask -> fetch /crowd/now -> call LLM -> return text
// Supports: OpenAI (default) or Bedrock Claude (via LLM_PROVIDER)

const https = require("https");

// --- small helpers ---
function jsonFetch(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: { ...headers },
    };
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data || "{}")); } catch (e) { resolve({}); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

// naive parser: extract route/stop/bus from message
function extractParamsFromMessage(msg) {
  const out = { route: "CC" };
  // stop: single letter A-G
  const mStop = msg.match(/\b([A-G])\b/i);
  if (mStop) out.stop = mStop[1].toUpperCase();

  // explicit route like "route CC"
  const mRoute = msg.match(/\broute\s+([A-Za-z0-9-]+)\b/i);
  if (mRoute) out.route = mRoute[1].toUpperCase();

  // bus id like "bus 01" or "bus CC-1"
  const mBus = msg.match(/\bbus[-\s]?([0-9]{1,2})\b/i);
  if (mBus) out.bus_id = mBus[1].padStart(2, "0");

  // optional window minutes
  const mWin = msg.match(/\bwin\s*[:=]\s*(\d{1,3})\b/i);
  if (mWin) out.win = Number(mWin[1]);

  return out;
}

// build prompt for LLM (single-shot, tool result embedded)
function buildPrompt(userText, crowdResult, parsed) {
  const tool = JSON.stringify(crowdResult, null, 2);
  const facts = JSON.stringify(parsed);

  return {
    system: `You are Campus Connect Assistant. Answer concisely in English.
- Task: Use the structured crowd data to answer routing/load questions.
- "level": 1 not busy … 4 packed
- Prefer actionable wording (e.g., "Take CC at stop D in ~3 min; choose bus with lower load if flexible").`,
    user: `User question:
${userText}

Parsed params (may be partial):
${facts}

Tool result from /crowd/now:
${tool}

Please summarize what it means for the user. If route/stop are missing, guide them to pick one.`
  };
}

// ---- OpenAI call ----
async function callOpenAI({ system, user }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const body = JSON.stringify({
    model,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ],
    temperature: 0.2
  });

  const resp = await jsonFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${apiKey}`,
    },
    body
  });
  return resp.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't draft a reply.";
}

// ---- Bedrock Claude call ----
async function callBedrockClaude({ system, user }) {
  // lightweight HTTPS call to Bedrock invoke (REST). For production you can switch to @aws-sdk/client-bedrock-runtime
  const modelId = process.env.BEDROCK_MODEL || "anthropic.claude-3-5-sonnet-20240620-v1:0";
  const region = process.env.AWS_REGION || "us-east-1";
  // Bedrock REST endpoint
  const url = `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/invoke-with-response-stream`;

  const body = JSON.stringify({
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 400,
    messages: [
      { role: "system", content: [{ type: "text", text: system }] },
      { role: "user", content: [{ type: "text", text: user }] }
    ]
  });

  // Bedrock requires AWS SigV4 signing; to keep hackathon简单，建议改用 @aws-sdk/client-bedrock-runtime。
  // 这里给出错误提示，方便你切换到 OpenAI 先跑通。
  throw new Error("For Bedrock in Lambda, please use @aws-sdk/client-bedrock-runtime with SigV4. Switch LLM_PROVIDER=openai to run immediately.");
}

async function runLLM(prompt) {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  if (provider === "openai") return callOpenAI(prompt);
  if (provider === "bedrock" || provider === "anthropic") return callBedrockClaude(prompt);
  return "Unsupported LLM provider. Set LLM_PROVIDER to 'openai' or 'bedrock'.";
}

// CORS headers
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "OPTIONS,POST",
  "access-control-allow-headers": "content-type,authorization"
};

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS, body: "" };
  }

  try {
    const b = JSON.parse(event.body || "{}");
    const userText = String(b.message || "").trim();

    // 1) 从用户问题里尽力抽 route/stop/bus_id/win
    const parsed = { route: "CC", win: 15, ...extractParamsFromMessage(userText), ...b };

    // 必须至少有 stop 才能给出针对性拥挤度；若没有，就让 LLM 引导
    let crowd = { note: "no stop selected yet" };
    if (parsed.stop) {
      const base = process.env.CROWD_BASE; // e.g. https://.../Prod
      const qs = new URLSearchParams({
        route: parsed.route,
        stop: parsed.stop,
        ...(parsed.bus_id ? { bus_id: parsed.bus_id } : {}),
        ...(parsed.win ? { win: String(parsed.win) } : {})
      }).toString();
      crowd = await jsonFetch(`${base}/crowd/now?${qs}`);
    }

    // 2) 构建 prompt & 调 LLM
    const prompt = buildPrompt(userText, crowd, parsed);
    const text = await runLLM(prompt);

    return {
      statusCode: 200,
      headers: { "content-type": "application/json", ...CORS },
      body: JSON.stringify({ ok: true, answer: text, used: { parsed, crowd } })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json", ...CORS },
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
};
