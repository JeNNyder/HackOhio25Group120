'use client';

import { Poppins } from 'next/font/google';
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['600', '700'],
});

import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, X, Zap, TrendingDown, Navigation, Send } from 'lucide-react';
import { fetchCrowdNow, postReport } from "@/lib/api"; 

/** ---------- Types ---------- */
interface BusStop {
  id: number;
  name: string;
  lat: number;
  lng: number;
}
type LoadLevel = 'empty' | 'somewhat empty' | 'somewhat busy' | 'busy';
interface Bus {
  id: string;
  name: string;
  currentStop: BusStop;
  load: LoadLevel;
  eta: number;
  position: { lat: number; lng: number };
  progress01: number; // [0,1) along the CLOSED orthogonal loop
}
interface Message {
  type: 'user' | 'bot';
  text: string;
}
interface Shortcut {
  icon: React.ReactNode;
  text: string;
  action: 'fastest' | 'lowest' | 'next';
}

/** ---------- Stops ---------- */
const busStops: BusStop[] = [
  { id: 1, name: 'A', lat: 40.002, lng: -83.010 },
  { id: 2, name: 'B', lat: 40.002, lng: -83.007 },
  { id: 3, name: 'C', lat: 40.005, lng: -83.003 },
  { id: 4, name: 'D', lat: 40.009, lng: -83.005 },
  { id: 5, name: 'E', lat: 40.009, lng: -83.008 },
  { id: 6, name: 'F', lat: 40.013, lng: -83.010 },
  { id: 7, name: 'G', lat: 40.007, lng: -83.012 },
];

/** ---------- Math helpers ---------- */
function segLen(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  return Math.hypot(dLat, dLng);
}
function interpolate(a: { lat: number; lng: number }, b: { lat: number; lng: number }, t: number) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

/** ---------- ORTHOGONAL LOOP (movement + ETA share the same geometry) ---------- */
function buildOrthoLoopSegments(stops: BusStop[]) {
  type Seg = { a: { lat: number; lng: number }; b: { lat: number; lng: number }; len: number };
  const segs: Seg[] = [];
  const n = stops.length;
  if (!n) return segs;

  for (let i = 0; i < n; i++) {
    const aStop = stops[i];
    const bStop = stops[(i + 1) % n]; // wraps G→A

    const a = { lat: aStop.lat, lng: aStop.lng };
    const elbow = { lat: aStop.lat, lng: bStop.lng }; // horizontal first
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
  return segs;
}

function pointAlongOrthoLoop(stops: BusStop[], t: number) {
  const segs = buildOrthoLoopSegments(stops);
  const total = segs.reduce((s, seg) => s + seg.len, 0) || 1e-9;
  let dist = ((t % 1) + 1) % 1 * total;

  for (const seg of segs) {
    if (dist <= seg.len) {
      const f = seg.len === 0 ? 0 : dist / seg.len;
      return interpolate(seg.a, seg.b, f);
    }
    dist -= seg.len;
  }
  return { lat: stops[0].lat, lng: stops[0].lng };
}

function stopProgressMapOrtho(stops: BusStop[]) {
  const segs = buildOrthoLoopSegments(stops);
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

function nearestStop(pos: { lat: number; lng: number }, stops: BusStop[]) {
  let best = stops[0];
  let bestD = Infinity;
  for (const s of stops) {
    const d = segLen(pos, s);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best;
}

/** speed as fraction-of-loop per minute */
const SPEED_FRACTION_PER_MIN = 0.08;

/** ---------- Buses placed ALONG the orthogonal loop ---------- */
function generateBusData(): Bus[] {
  const day = new Date().getDay(); // 0 Sun ... 6 Sat
  const isWeekend = day === 0 || day === 6;
  const busCount = isWeekend ? 2 : 4;

  return Array.from({ length: busCount }, (_, k) => {
    const t = (k + 1) / (busCount + 1); // evenly spaced on loop
    const pos = pointAlongOrthoLoop(busStops, t);
    const stop = nearestStop(pos, busStops);
    return {
      id: `CC-${k + 1}`,
      name: `Campus Connect ${k + 1}`,
      currentStop: stop,
      load: (['empty', 'somewhat empty', 'somewhat busy', 'busy'] as const)[Math.floor(Math.random() * 4)],
      eta: Math.floor(Math.random() * 15) + 2,
      position: pos,
      progress01: t,
    };
  });
}

/** ---------- Load Indicator ---------- */
const LoadIndicator: React.FC<{ load: LoadLevel }> = ({ load }) => {
  const colors: Record<LoadLevel, string> = {
    empty: 'bg-green-500',
    'somewhat empty': 'bg-yellow-400',
    'somewhat busy': 'bg-orange-500',
    busy: 'bg-red-500',
  };
  const levels: LoadLevel[] = ['empty', 'somewhat empty', 'somewhat busy', 'busy'];
  const idx = levels.indexOf(load);
  return (
    <div className="flex gap-1 items-center">
      {levels.map((lvl, i) => (
        <div key={lvl} className={`h-3 w-8 rounded-sm ${i <= idx ? colors[load] : 'bg-gray-200'}`} />
      ))}
      <span className="ml-2 text-sm font-medium capitalize">{load}</span>
    </div>
  );
};

/** ---------- Cards / Panels ---------- */
const BusCard: React.FC<{ bus: Bus; onClick: () => void }> = ({ bus, onClick }) => (
  <button
    onClick={onClick}
    className="bg-white rounded-lg shadow-md p-4 mb-3 text-left hover:shadow-lg transition-shadow border-l-4 border-red-600"
  >
    <div className="flex justify-between items-start mb-3">
      <div>
        <h3 className="font-bold text-lg text-gray-800">{bus.name}</h3>
        <p className="text-sm text-gray-600">Currently at: {bus.currentStop.name}</p>
      </div>
      <div className="text-right">
        <div className="text-red-600 font-semibold">{bus.eta} min</div>
        <div className="text-xs text-gray-500">ETA</div>
      </div>
    </div>
    <LoadIndicator load={bus.load} />
  </button>
);

/** ---------- Histogram Modal (7:30–9:30) ---------- */
const timeLabels = [
  '7:30',
  '7:40',
  '7:50',
  '8:00',
  '8:10',
  '8:20',
  '8:30',
  '8:40',
  '8:50',
  '9:00',
  '9:10',
  '9:20',
  '9:30',
];

function seededRand(seedStr: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h += h << 13;
    h ^= h >>> 7;
    h += h << 3;
    h ^= h >>> 17;
    h += h << 5;
    return (h >>> 0) / 4294967295;
  };
}

function makeMockLoadSeries(busId: string): number[] {
  const rnd = seededRand(busId);
  return timeLabels.map((_, i) => {
    const peak = Math.exp(-Math.pow((i - 8) / 3, 2));
    const base = 0.2 + 0.6 * peak + 0.2 * rnd();
    return Math.min(1, Math.max(0, base));
  });
}

const BusLoadModal: React.FC<{ bus: Bus; onClose: () => void }> = ({ bus, onClose }) => {
  const series = useMemo(() => makeMockLoadSeries(bus.id), [bus.id]);

  // virtual canvas
  const W = 800;
  const H = 200;
  const M = { top: 8, right: 10, bottom: 48, left: 48 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;

  const gap = 8;
  const totalBars = series.length;
  const barW = (plotW - gap * (totalBars + 1)) / totalBars;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-xl font-bold text-gray-800">{bus.name} — Load (7:30–9:30)</h3>
            <p className="text-xs text-gray-500">Mock data for demo — replace with backend later</p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 rounded-full p-1" aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="w-full">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            preserveAspectRatio="none"
            className="w-full h-48"
            style={{
              fontFamily:
                'Poppins, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
            }}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
              const y = M.top + (1 - t) * plotH;
              return (
                <g key={idx}>
                  <line x1={M.left} x2={W - M.right} y1={y} y2={y} stroke="#e5e7eb" strokeDasharray="4 4" />
                  <text x={M.left - 10} y={y + 3} textAnchor="end" fill="#6b7280" fontSize="10">
                    {Math.round(t * 100)}%
                  </text>
                </g>
              );
            })}

            {series.map((v, i) => {
              const h = v * plotH;
              const x = M.left + gap + i * (barW + gap);
              const y = M.top + (plotH - h);
              const color =
                v < 0.25 ? '#e2c8c8ff' : v < 0.5 ? '#d7a2a2ff' : v < 0.75 ? '#de8484ff' : '#de5353ff';
              return (
                <g key={i}>
                  <rect x={x} y={y} width={barW} height={h} rx={4} fill={color} />
                  <text x={x + barW / 2} y={H - M.bottom + 20} textAnchor="middle" fontSize="10" fill="#6b7280">
                    {timeLabels[i]}
                  </text>
                </g>
              );
            })}

            <line x1={M.left} x2={W - M.right} y1={H - M.bottom} y2={H - M.bottom} stroke="#e5e7eb" />
          </svg>
        </div>

        <div className="mt-4 flex items-center gap-4 text-xs text-gray-600">
          <LegendSwatch color="#e2c8c8ff" label="Empty" />
          <LegendSwatch color="#d7a2a2ff" label="Somewhat empty" />
          <LegendSwatch color="#de8484ff" label="Somewhat busy" />
          <LegendSwatch color="#de5353ff" label="Busy" />
        </div>
      </div>
    </div>
  );
};

const LegendSwatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
  <div className="flex items-center gap-2">
    <span className="inline-block w-3 h-3 rounded" style={{ background: color }} />
    <span>{label}</span>
  </div>
);

/** ---------- Stop Detail ---------- */
const BusStopDetail: React.FC<{ stop: BusStop; buses: Bus[]; onClose: () => void }> = ({
  stop,
  buses,
  onClose,
}) => {
  const tMap = useMemo(() => stopProgressMapOrtho(busStops), []);
  const stopT = tMap.get(stop.id) ?? 0;

  const rows = useMemo(() => {
    return buses
      .map((b) => {
        const delta = (stopT - b.progress01 + 1) % 1; // wrap
        const etaMin = delta / SPEED_FRACTION_PER_MIN;
        return { bus: b, eta: etaMin };
      })
      .sort((a, b) => a.eta - b.eta);
  }, [buses, stopT]);

  return (
    <div className="bg-white rounded-xl shadow-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-xl text-gray-800">{stop.name}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <X size={22} />
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="text-gray-500 text-center py-4">No upcoming arrivals</p>
      ) : (
        <div className="space-y-2">
          {rows.map(({ bus, eta }) => (
            <div key={bus.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
              <div>
                <div className="font-semibold text-gray-800">{bus.name}</div>
                <div className="text-xs text-gray-500">ETA: {Math.max(0, Math.round(eta))} min</div>
              </div>
              <LoadIndicator load={bus.load} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/** ---------- Map (orthogonal closed polyline) ---------- */
const SimpleMap: React.FC<{
  buses: Bus[];
  stops: BusStop[];
  selectedStop: BusStop | null;
  onStopSelect: (s: BusStop) => void;
}> = ({ buses, stops, selectedStop, onStopSelect }) => {
  const pad = 0.0008;
  const minLat = Math.min(...stops.map((s) => s.lat)) - pad;
  const maxLat = Math.max(...stops.map((s) => s.lat)) + pad;
  const minLng = Math.min(...stops.map((s) => s.lng)) - pad;
  const maxLng = Math.max(...stops.map((s) => s.lng)) + pad;

  const latSpan = Math.max(1e-6, maxLat - minLat);
  const lngSpan = Math.max(1e-6, maxLng - minLng);

  const normLeft = (lng: number) => `${((lng - minLng) / lngSpan) * 100}%`;
  const normTop = (lat: number) => `${((lat - minLat) / latSpan) * 100}%`;

  function orthogonalPointsSVG(sts: BusStop[]) {
    const pts: { lat: number; lng: number }[] = [];
    const n = sts.length;
    if (!n) return pts;
    for (let i = 0; i < n; i++) {
      const a = sts[i],
        b = sts[(i + 1) % n];
      pts.push({ lat: a.lat, lng: a.lng });
      const elbow = { lat: a.lat, lng: b.lng };
      if (elbow.lat !== a.lat || elbow.lng !== a.lng) pts.push(elbow);
      if (b.lat !== elbow.lat || b.lng !== elbow.lng) pts.push({ lat: b.lat, lng: b.lng });
    }
    return pts;
  }

  const svgPoints = useMemo(() => {
    return orthogonalPointsSVG(stops)
      .map((p) => {
        const x = ((p.lng - minLng) / lngSpan) * 100;
        const y = ((p.lat - minLat) / latSpan) * 100;
        return `${x},${y}`;
      })
      .join(' ');
  }, [stops, minLng, lngSpan, minLat, latSpan]);

  return (
    <div className="relative w-full bg-gradient-to-br from-red-100 to-blue-100 rounded-lg overflow-hidden" style={{ height: 400 }}>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none" style={{ zIndex: 1 }}>
        <polyline points={svgPoints} fill="none" stroke="#ff6b6bff" strokeWidth="0.7" strokeLinejoin="round" strokeLinecap="round" />
      </svg>

      {stops.map((stop) => (
        <button
          key={stop.id}
          onClick={() => onStopSelect(stop)}
          style={{ left: normLeft(stop.lng), top: normTop(stop.lat), transform: 'translate(-50%, -50%)' }}
          className={`absolute z-20 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
            selectedStop?.id === stop.id ? 'bg-red-600 scale-125 shadow-lg' : 'bg-white border-2 border-red-600 hover:scale-110'
          }`}
          title={stop.name}
        >
          <span className="w-3 h-3 bg-red-600 rounded-full" />
        </button>
      ))}

      {buses.map((bus) => (
        <div
          key={bus.id}
          style={{ left: normLeft(bus.position.lng), top: normTop(bus.position.lat), transform: 'translate(-50%, -50%)' }}
          className="absolute z-30 bg-red-600 text-white rounded-lg px-2 py-1 text-xs font-bold shadow-lg animate-pulse"
          title={bus.name}
        >
          {bus.name.split(' ')[2]}
        </div>
      ))}

      <div className="absolute bottom-3 right-3 bg-white/60 backdrop-blur-sm rounded-lg p-3 shadow-md text-xs z-10 border border-white/30">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 bg-red-600 rounded" />
          <span>Active Bus</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-white border-2 border-red-600 rounded-full" />
          <span>Bus Stop</span>
        </div>
      </div>
    </div>
  );
};

/** ---------- Chat (fixed floating widget) ---------- */
const ChatDock: React.FC<{ expanded: boolean; onToggle: () => void }> = ({ expanded, onToggle }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
// Streams a single user prompt to /api/chat and appends the assistant reply
const sendLLMMessage = async (userText: string) => {
  if (!userText) return;

  // 1) push the user message
  setMessages(prev => [...prev, { type: 'user', text: userText }]);

  // 2) create a placeholder assistant bubble we’ll stream into
  setMessages(prev => [...prev, { type: 'bot', text: '' }]);

  // Build an OpenAI/Anthropic-style history from current messages (excluding the just-added placeholder)
  const history = messages.map(m =>
    m.type === 'user'
      ? ({ role: 'user', content: m.text } as const)
      : ({ role: 'assistant', content: m.text } as const)
  );

  const body = JSON.stringify({
    messages: [
      { role: 'system', content: 'You are a helpful campus bus assistant for OSU CC routes. Be concise, ask for any missing details (like start/destination), and return ETAs/loads clearly.' },
      ...history,
      { role: 'user', content: userText },
    ],
  });

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });

    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      acc += decoder.decode(value, { stream: true });

      // stream into the last bot message
      setMessages(prev => {
        const copy = [...prev];
        copy[copy.length - 1] = { type: 'bot', text: acc };
        return copy;
      });
    }
  } catch {
    // replace the placeholder with an error
    setMessages(prev => [
      ...prev.slice(0, -1),
      { type: 'bot', text: '⚠️ Sorry, I had trouble reaching the assistant.' },
    ]);
  }
};

  const shortcuts: Shortcut[] = useMemo(
    () => [
      { icon: <Navigation size={16} />, text: 'Fastest Path', action: 'fastest' },
      { icon: <TrendingDown size={16} />, text: 'Lowest Load', action: 'lowest' },
      { icon: <Zap size={16} />, text: 'Next Bus', action: 'next' },
    ],
    []
  );

  const handleShortcut = (action: Shortcut['action']) => {
    const canned =
      action === 'fastest'
        ? "Tell me start and destination, e.g., 'Fastest route from Student Union to Library'."
        : action === 'lowest'
        ? 'Right now CC-2 looks empty near Recreation Center; CC-4 is somewhat empty near Engineering.'
        : 'Next CC bus to Student Union is ~3 minutes.';
    const label = shortcuts.find((s) => s.action === action)?.text ?? 'Shortcut';
    setMessages((prev) => [...prev, { type: 'user', text: label }, { type: 'bot', text: canned }]);
  };

  const handleSend = async () => {
  const q = input.trim();
  if (!q) return;
  setInput('');
  await sendLLMMessage(q);
};


  // Collapsed: floating button
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

  // Expanded: floating panel
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
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
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
};

/** ---------- Page ---------- */
export default function CampusBusTracker() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);

  // staged load animation flags
  const [showTitle, setShowTitle] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const [showList, setShowList] = useState(false);
  const [showChat, setShowChat] = useState(false);

  // histogram modal
  const [modalBus, setModalBus] = useState<Bus | null>(null);
  

  useEffect(() => {
    setBuses(generateBusData());
  }, []);

  // loop movement (~1s tick)
  useEffect(() => {
    const id = setInterval(() => {
      setBuses((prev) =>
        prev.map((b) => {
          const progress = (b.progress01 + SPEED_FRACTION_PER_MIN / 60) % 1;
          const pos = pointAlongOrthoLoop(busStops, progress);
          return {
            ...b,
            progress01: progress,
            position: pos,
            currentStop: nearestStop(pos, busStops),
          };
        })
      );
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // staged appear
  useEffect(() => {
    setShowTitle(true);
    const t1 = setTimeout(() => setShowMap(true), 150);
    const t2 = setTimeout(() => setShowList(true), 350);
    const t3 = setTimeout(() => setShowChat(true), 550);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, []);

  // backend integration states
  const [crowd, setCrowd] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reportLevel, setReportLevel] = useState<number>(3);
  const [reportHeadcount, setReportHeadcount] = useState<number | "">("");

  // call /crowd/now for the selected stop
  async function onQueryCrowd() {
    if (!selectedStop) return;
    setLoading(true); setError(""); setCrowd(null);
    try {
      const res = await fetchCrowdNow({
        route: "CC",
        stop: selectedStop.name ?? String(selectedStop.id),
        win: 15,
      });
      setCrowd(res);
    } catch (e: any) {
      setError(e.message ?? "Request failed");
    } finally {
      setLoading(false);
    }
  }

  // POST /report (rider example); refresh crowd after saving
  async function onSubmitReport() {
    if (!selectedStop) return;
    setLoading(true); setError("");
    try {
      await postReport({
        route: "CC",
        stop: selectedStop.name ?? String(selectedStop.id),
        source: "rider",
        level: Number(reportLevel),
        headcount: reportHeadcount === "" ? undefined : Number(reportHeadcount),
      });
      await onQueryCrowd();
    } catch (e: any) {
      setError(e.message ?? "Report failed");
    } finally {
    setLoading(false);
  }}

  const appear = (on: boolean) =>
    `transition-all duration-700 ease-out ${on ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`;

  return (
  <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className={`${appear(showTitle)} mb-8`}>
        <h1
          className={`${poppins.className} text-5xl font-extrabold bg-gradient-to-r from-red-700 to-pink-600 bg-clip-text text-transparent tracking-tight`}
        >
          Campus Connect
        </h1>
        <p className="text-gray-600">Real-time bus tracking and load monitoring</p>
        <div className="mt-2 text-sm text-gray-500">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </div>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 gap-6">
        <div>
          {/* Map */}
          <div className={appear(showMap)}>
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Bus Route Map</h2>

            <SimpleMap
              buses={buses}
              stops={busStops}
              selectedStop={selectedStop}
              onStopSelect={setSelectedStop}
            />

            {/* === Crowd panel + Report form (only when a stop is selected) === */}
            {selectedStop && (
              <div className="mt-6 rounded-xl border p-4 bg-white/70 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm text-gray-500">Selected stop</div>
                    <div className="text-lg font-semibold">
                      {selectedStop.name ?? String(selectedStop.id)}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={onQueryCrowd}
                      className="px-3 py-2 rounded-lg border bg-white hover:bg-gray-50"
                    >
                      Query crowd
                    </button>
                  </div>
                </div>

                {/* result / loading / error */}
                <div className="mt-3">
                  {loading && <div className="text-sm text-gray-500">Loading…</div>}
                  {error && <div className="text-sm text-red-600">{error}</div>}
                  {crowd && (
                    <div className="text-sm text-gray-700">
                      <div>
                        Level: <b>{crowd.level}</b>{" "}
                        <span className="text-gray-500">(1 not busy → 4 packed)</span>
                      </div>
                      <div>
                        Est. headcount: <b>{crowd.est_headcount}</b>{" "}
                        {Array.isArray(crowd.headcount_ci68) && (
                          <span className="text-gray-500">
                            (CI68: {crowd.headcount_ci68[0]} ~ {crowd.headcount_ci68[1]})
                          </span>
                        )}
                      </div>
                      <div>
                        Remaining capacity: <b>{crowd.remaining_capacity}</b>
                      </div>
                      <div className="text-gray-500">
                        confidence: {crowd.confidence} · reports: {crowd.counts?.reports ?? 0}
                      </div>
                    </div>
                  )}
                </div>

                {/* report form */}
                <div className="mt-4 grid md:grid-cols-3 gap-3">
                  <label className="text-sm">
                    Level (1–4)
                    <input
                      type="number"
                      min={1}
                      max={4}
                      value={reportLevel}
                      onChange={(e) => setReportLevel(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border px-2 py-1"
                    />
                  </label>

                  <label className="text-sm">
                    Headcount (optional)
                    <input
                      type="number"
                      min={0}
                      max={60}
                      value={reportHeadcount}
                      onChange={(e) =>
                        setReportHeadcount(e.target.value === "" ? "" : Number(e.target.value))
                      }
                      className="mt-1 w-full rounded-md border px-2 py-1"
                    />
                  </label>

                  <div className="flex items-end">
                    <button
                      onClick={onSubmitReport}
                      className="w-full px-3 py-2 rounded-lg bg-red-600 text-white hover:bg-red-700"
                      disabled={loading}
                    >
                      Submit report
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Stop detail (existing) */}
            {selectedStop && (
              <div className="mt-6">
                <BusStopDetail
                  stop={selectedStop}
                  buses={buses}
                  onClose={() => setSelectedStop(null)}
                />
              </div>
            )}
          </div>

          {/* List */}
          <div className={`${appear(showList)} mt-8`}>
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Active Buses (CC)</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {buses.map((bus) => (
                <BusCard
                  key={bus.id}
                  bus={bus}
                  onClick={() => {
                    setModalBus(bus); // open histogram
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>

    {/* Floating Chatbot (single instance) */}
    {showChat && (
      <ChatDock expanded={chatExpanded} onToggle={() => setChatExpanded((v) => !v)} />
    )}

    {/* Histogram Modal */}
    {modalBus && <BusLoadModal bus={modalBus} onClose={() => setModalBus(null)} />}
  </div>
);
}
