// scripts/seed-ddb.js
// Generate 1 week of synthetic crowd reports into DynamoDB "bus_app"

const { DynamoDBClient, BatchWriteItemCommand } = require("@aws-sdk/client-dynamodb");
const { marshall } = require("@aws-sdk/util-dynamodb");

const REGION = process.env.AWS_REGION || "us-east-1";
const TABLE = process.env.TABLE_NAME || "bus_app";

// ---- Configurable parameters ----
const ROUTE = "CC";
const STOPS = ["A","B","C","D","E","F","G"];          // 7 stops
const BUSES = ["01","02","03","04","05"];             // 5 buses
const CAP = 60;                                        // bus capacity
const MIN_STEP_MIN = 5;                                // one record every 5 minutes
const DAYS = 7;                                        // one full week
const START_HHMM = {h:7, m:30};
const END_HHMM   = {h:21, m:30};

// Peak windows (inclusive start, exclusive end) in minutes from 00:00
const peaks = [
  [7*60+30,  9*60+30],    // morning peak
  [11*60+30, 13*60+30],   // noon peak
  [16*60+30, 19*60+30],   // evening peak
];

const client = new DynamoDBClient({ region: REGION });

// map occupancy fraction -> level
function fracToLevel(frac) {
  if (frac < 0.25) return 1;
  if (frac < 0.5)  return 2;
  if (frac < 0.75) return 3;
  return 4;
}

// Time-of-day demand factor [0..1], with three peaks; weekends lower
function demandFactor(date) {
  const dow = date.getUTCDay(); // 0=Sun..6=Sat
  const isWeekend = (dow === 0 || dow === 6);
  const minutes = date.getUTCHours()*60 + date.getUTCMinutes();

  let base = 0.15; // off-peak baseline
  for (const [s,e] of peaks) {
    if (minutes >= s && minutes < e) {
      base = Math.max(base, 0.8); // strong peak
    }
  }
  if (!peaks.some(([s,e]) => minutes >= s && minutes < e)) {
    // shoulder hours: a bit higher than baseline, e.g. late morning / afternoon
    if ((minutes >= 9*60+30 && minutes < 11*60) ||
        (minutes >= 13*60+30 && minutes < 16*60) ||
        (minutes >= 19*60 && minutes < 21*60+30)) {
      base = Math.max(base, 0.35);
    }
  }
  // weekend downscale
  return isWeekend ? base * 0.7 : base;
}

// small gaussian-ish noise
function jitter(std=0.05) {
  // Box–Muller
  const u = 1 - Math.random();
  const v = 1 - Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std;
}

function* timeSlots(startDateUtc) {
  // generate time slots for DAYS days, from START_HHMM to END_HHMM every MIN_STEP_MIN
  const start = new Date(Date.UTC(
    startDateUtc.getUTCFullYear(),
    startDateUtc.getUTCMonth(),
    startDateUtc.getUTCDate(),
    START_HHMM.h, START_HHMM.m, 0, 0
  ));
  for (let d=0; d<DAYS; d++) {
    const dayStart = new Date(start.getTime() + d*24*60*60*1000);
    for (let t = dayStart.getTime();
         t <= new Date(Date.UTC(
           dayStart.getUTCFullYear(),
           dayStart.getUTCMonth(),
           dayStart.getUTCDate(),
           END_HHMM.h, END_HHMM.m, 0, 0
         )).getTime();
         t += MIN_STEP_MIN*60*1000) {
      yield new Date(t);
    }
  }
}

async function batchWrite(items) {
  if (!items.length) return;
  const chunks = [];
  for (let i=0; i<items.length; i+=25) chunks.push(items.slice(i, i+25));
  for (const chunk of chunks) {
    const reqItems = chunk.map(Item => ({ PutRequest: { Item: marshall(Item) } }));
    await client.send(new BatchWriteItemCommand({ RequestItems: { [TABLE]: reqItems } }));
  }
}

async function main() {
  // Start from last Monday 00:00 UTC to make a clean week, or use "today - 6 days"
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0,0,0,0));
  start.setUTCDate(start.getUTCDate() - 6); // past 6 days + today = 7 days

  console.log(`Seeding table ${TABLE} in ${REGION} for ${DAYS} days...`);

  let buffer = [];
  let count = 0;

  for (const ts of timeSlots(start)) {
    // rotate buses across stops to look realistic
    STOPS.forEach((stop, si) => {
      const bus = BUSES[(Math.floor(ts.getTime()/ (MIN_STEP_MIN*60*1000)) + si) % BUSES.length];

      // demand -> occupancy fraction with noise
      const frac = Math.min(0.98, Math.max(0.02, demandFactor(ts) + jitter(0.05)));
      const head = Math.max(0, Math.round(frac * CAP + (Math.random()*4-2))); // +/-2 ppl noise
      const level = fracToLevel(head / CAP);

      // small chance of "driver" vs "rider"
      const source = Math.random() < 0.12 ? "driver" : "rider";

      const iso = ts.toISOString(); // use UTC so it’s sortable lexicographically
      buffer.push({
        PK: `REPORT#${ROUTE}#${stop}`,
        SK: iso,
        route: ROUTE,
        stop,
        bus_id: bus,
        source,
        level,
        headcount: head,
        created_at: iso
      });

      // flush per ~500 items to speed up
      if (buffer.length >= 500) {
        batchWrite(buffer).catch(console.error);
        count += buffer.length;
        console.log(`Wrote ${count} items so far...`);
        buffer = [];
      }
    });
  }
  if (buffer.length) {
    await batchWrite(buffer);
    count += buffer.length;
  }
  console.log(`Done. Total items written: ${count}`);
}

main().catch(e => { console.error(e); process.exit(1); });

