// components/ChatDock.tsx — Client Component
'use client';

import React, { useMemo, useState } from 'react';
import { MessageCircle, X, Zap, TrendingDown, Navigation, Send } from 'lucide-react';
import { fetchCrowdNow } from '@/lib/api';

/* ===================== Types ===================== */
type Message = { type: 'user' | 'bot'; text: string };
type Shortcut = { icon: React.ReactNode; text: string; action: 'fastest' | 'lowest' | 'next' };
type LoadLevel = 'empty' | 'somewhat empty' | 'somewhat busy' | 'busy';
export type BusStop = { id: number; name: string; lat: number; lng: number };
export type Bus = {
  id: string;
  name: string;
  currentStop: BusStop;
  load: LoadLevel;
  eta: number;
  position: { lat: number; lng: number };
  progress01: number; // [0,1) position along the loop
};

/* ===================== Local geometry/helpers (self-contained) ===================== */
const busStops: BusStop[] = [
  { id: 1, name: 'A', lat: 40.002, lng: -83.010 },
  { id: 2, name: 'B', lat: 40.002, lng: -83.007 },
  { id: 3, name: 'C', lat: 40.005, lng: -83.003 },
  { id: 4, name: 'D', lat: 40.009, lng: -83.005 },
  { id: 5, name: 'E', lat: 40.009, lng: -83.008 },
  { id: 6, name: 'F', lat: 40.013, lng: -83.010 },
  { id: 7, name: 'G', lat: 40.007, lng: -83.012 },
];

// same constant as your page logic
const SPEED_FRACTION_PER_MIN = 0.08;

function segLen(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  return Math.hypot(dLat, dLng);
}
function stopProgressMapOrtho(stops: BusStop[]) {
  type Pt = { lat: number; lng: number };
  const segs: { a: Pt; b: Pt; len: number }[] = [];
  const n = stops.length;
  for (let i = 0; i < n; i++) {
    const aStop = stops[i];
    const bStop = stops[(i + 1) % n];
    const a = { lat: aStop.lat, lng: aStop.lng };
    const elbow = { lat: aStop.lat, lng: bStop.lng };
    const b = { lat: bStop.lat, lng: bStop.lng };
    if (a.lng !== elbow.lng || a.lat !== elbow.lat) {
      const len = segLen(a, elbow);
      if (len > 0) segs.push({ a, b: elbow, len });
    }
    if (elbow.lng !== b.lng || elbow.lat !== b.lat) {
      const len2 = segLen(elbow, b);
      if (len2 > 0) segs.push({ a: elbow, b, len: len2 });
    }
  }
  const total = segs.reduce((s, seg) => s + seg.len, 0) || 1e-9;
  const map = new Map<number, number>();
  let acc = 0;
  map.set(stops[0].id, 0);
  for (let i = 0; i < stops.length - 1; i++) {
    const aStop = stops[i];
    const bStop = stops[i + 1];
    const a = { lat: aStop.lat, lng: aStop.lng };
    const elbow = { lat: aStop.lat, lng: bStop.lng };
    const b = { lat: bStop.lat, lng: bStop.lng };
    if (segLen(a, elbow) > 0) acc += segLen(a, elbow);
    if (segLen(elbow, b) > 0) acc += segLen(elbow, b);
    map.set(bStop.id, acc / total);
  }
  return map;
}

/* ===================== Backend crowd query (Plan B) ===================== */
async function queryStopLoadFromAPI(stop: BusStop) {
  try {
    const res = await fetchCrowdNow({
      route: 'CC',
      stop: stop.name,
      win: 15,
    });

    if (!res) return { ok: false, text: 'No data returned from backend.' };

    const text = `📊 Stop **${stop.name}**:
- Level: ${res.level} (1 = not busy → 4 = very busy)
- Estimated headcount: ${res.est_headcount}
- Remaining capacity: ${res.remaining_capacity}
- Confidence: ${res.confidence}`;

    return { ok: true, text };
  } catch (e: any) {
    return { ok: false, text: `Query failed: ${e?.message ?? String(e)}` };
  }
}

/* ===================== ChatDock ===================== */
export default function ChatDock({
  expanded,
  onToggle,
  buses,
}: {
  expanded: boolean;
  onToggle: () => void;
  buses: Bus[];
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  // map stops -> progress along loop
  const tMap = useMemo(() => stopProgressMapOrtho(busStops), []);

  function normalizeStopName(s: string) {
    return s.trim().toUpperCase();
  }
  function findStopByNameOrLetter(raw: string): BusStop | null {
    const key = normalizeStopName(raw);
    return busStops.find((s) => s.name.toUpperCase() === key) ?? null;
  }
  function parseFromTo(text: string): { from: BusStop; to: BusStop } | null {
    const t = text.trim();
    // "from X to Y"
    let m = t.match(/from\s+([a-z0-9\s]+?)\s+to\s+([a-z0-9\s]+)/i);
    if (m) {
      const a = findStopByNameOrLetter(m[1]);
      const b = findStopByNameOrLetter(m[2]);
      if (a && b) return { from: a, to: b };
    }
    // "A to B" / "A->B"
    m = t.match(/^\s*([A-G])\s*(?:to|->)\s*([A-G])\s*$/i);
    if (m) {
      const a = findStopByNameOrLetter(m[1]);
      const b = findStopByNameOrLetter(m[2]);
      if (a && b) return { from: a, to: b };
    }
    return null;
  }
  function etaBetweenStops(from: BusStop, to: BusStop) {
    const tFrom = tMap.get(from.id) ?? 0;
    const tTo = tMap.get(to.id) ?? 0;
    const deltaFrac = (tTo - tFrom + 1) % 1; // forward around the loop
    return Math.max(0, Math.round(deltaFrac / SPEED_FRACTION_PER_MIN));
  }
  function nextBusArrivalAt(stop: BusStop) {
    const tStop = tMap.get(stop.id) ?? 0;
    const etas = buses.map((b) => ((tStop - b.progress01 + 1) % 1) / SPEED_FRACTION_PER_MIN);
    if (!etas.length) return null;
    return Math.max(0, Math.round(Math.min(...etas)));
  }

  // Main send: local handlers (fastest/lowest) → LLM (OpenAI → Ollama)
  const sendLLMMessage = async (userText: string) => {
    if (!userText) return;

    // push user + placeholder bot message
    setMessages((prev) => [...prev, { type: 'user', text: userText }, { type: 'bot', text: '' }]);

    // 1) Local "From A to B" fastest path
    const parsed = parseFromTo(userText);
    if (parsed) {
      const { from, to } = parsed;
      const tripMin = etaBetweenStops(from, to);
      const nextAtOrigin = nextBusArrivalAt(from);
      const tip =
        nextAtOrigin != null
          ? `Next bus arrives at ${from.name} in ~${nextAtOrigin} min.`
          : `No live vehicle data right now.`;
      const reply = `✅ Fastest CC loop: **${from.name} → ${to.name}** ~ **${tripMin} min**, no transfers. ${tip}`;

      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { type: 'bot', text: reply };
        return copy;
      });
      return;
    }

    // Build history for LLM (if we need it)
    const historySnapshot = messages
      .concat({ type: 'user', text: userText })
      .map((m) => (m.type === 'user' ? ({ role: 'user', content: m.text } as const) : ({ role: 'assistant', content: m.text } as const)));

    const body = JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful campus bus assistant for OSU CC routes. Be concise, ask for any missing details (like start/destination), and return ETAs/loads clearly.',
        },
        ...historySnapshot,
      ],
    });

    // 2) Lowest Load handled via backend API first (Plan B)
    {
      const m = userText.toLowerCase();
      if (m.includes('lowest') || m.includes('least crowded') || m.includes('low load')) {
        // try extracting a stop letter A–G
        const match = m.match(/\b([A-G])\b/i);
        if (match) {
          const stop = busStops.find((s) => s.name.toUpperCase() === match[1].toUpperCase());
          if (stop) {
            const result = await queryStopLoadFromAPI(stop);
            setMessages((prev) => {
              const copy = [...prev];
              copy[copy.length - 1] = { type: 'bot', text: result.text };
              return copy;
            });
            return; // handled locally via backend
          }
        }
        // ask user to specify a stop
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = {
            type: 'bot',
            text: "Which stop should I check (A–G)? For example: 'Lowest load at A'.",
          };
          return copy;
        });
        return;
      }
    }

    // 3) Fallback to LLM (OpenAI → if 429 then Ollama)
    const call = (path: string) =>
      fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });

    try {
      let res = await call('/api/chat');
      if (!res.ok) {
        const errText = await res.text();
        let isQuota = false;
        try {
          const j = JSON.parse(errText);
          isQuota = j?.status === 429 || j?.code === 'insufficient_quota';
        } catch {}
        if (isQuota) {
          res = await call('/api/local'); // Ollama fallback
        } else {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { type: 'bot', text: `HTTP ${res.status}\n${errText}` };
            return copy;
          });
          return;
        }
      }

      if (!res.body) {
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { type: 'bot', text: '⚠️ No response body from LLM' };
          return copy;
        });
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const copy = [...prev];
          copy[copy.length - 1] = { type: 'bot', text: acc };
          return copy;
        });
      }
    } catch (e: any) {
      setMessages((prev) => {
        const copy = [...prev];
        copy[copy.length - 1] = { type: 'bot', text: `⚠️ Error: ${e?.message ?? String(e)}` };
        return copy;
      });
    }
  };

  const handleSend = async () => {
    const q = input.trim();
    if (!q) return;
    setInput('');
    await sendLLMMessage(q);
  };

  const shortcuts: Shortcut[] = useMemo(
    () => [
      { icon: <Navigation size={16} />, text: 'Fastest Path', action: 'fastest' },
      { icon: <TrendingDown size={16} />, text: 'Lowest Load', action: 'lowest' },
      { icon: <Zap size={16} />, text: 'Next Bus', action: 'next' },
    ],
    []
  );

  const handleShortcut = async (action: Shortcut['action']) => {
    const label = shortcuts.find((s) => s.action === action)?.text ?? 'Shortcut';
    setMessages((prev) => [...prev, { type: 'user', text: label }]);

    const prompt =
      action === 'fastest'
        ? "Find the fastest route on CC buses. If I didn't give both start and destination, ask for them briefly (e.g., 'From A to B?'). Then give the fastest option with ETA and any transfers."
        : action === 'lowest'
        ? "Find the lowest load. If I didn't specify a stop, ask which stop (A–G). If provided, return the current load info."
        : "Tell me the next CC bus arrival. If I didn't say the stop, ask me for the stop name first; otherwise give the arrival window and confidence.";

    await sendLLMMessage(prompt);
  };

  if (!expanded) {
    return (
      <button
        onClick={onToggle}
        className="fixed z-50 bottom-1 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 bg-gray-600 text-white px-4 py-3 rounded-full shadow-xl hover:bg-gray-700"
        aria-label="Open chatbot"
      >
        <MessageCircle size={20} />
        <span className="font-medium">Ask anything</span>
      </button>
    );
  }

  return (
    <div className="fixed z-50 bottom-5 left-1/2 -translate-x-1/2 sm:w-[380px] w-[calc(100vw-1.5rem)] sm:max-h-[80vh] max-h-[85vh] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
      <div className="bg-gray-600 text-white p-3 sm:p-4 flex justify-between items-center">
        <div className="flex items-center gap-2">
          <MessageCircle size={22} />
          <h3 className="font-semibold">Campus Connect Assistant</h3>
        </div>
        <button onClick={onToggle} className="hover:bg-gray-700 rounded-full p-1" aria-label="Close chatbot">
          <X size={18} />
        </button>
      </div>

      <div className="flex gap-2 p-2 sm:p-3 bg-gray-50 border-b overflow-x-auto">
        {shortcuts.map((s) => (
          <button
            key={s.text}
            onClick={() => handleShortcut(s.action)}
            className="flex items-center gap-1 bg-white hover:bg-red-50 text-red-600 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap border border-red-200 transition-colors"
          >
            {s.icon}
            {s.text}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <MessageCircle size={44} className="mx-auto mb-2 text-gray-300" />
            <p className="font-medium">How can I help you today?</p>
            <p className="text-sm mt-1">Ask about routes, loads, or ETAs</p>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] p-3 rounded-2xl ${
                  m.type === 'user' ? 'bg-gray-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-3 border-t bg-gray-50">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Type your question..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-gray-600"
          />
          <button onClick={handleSend} className="bg-gray-600 hover:bg-gray-700 text-white rounded-full p-2">
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
