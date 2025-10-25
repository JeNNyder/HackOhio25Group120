'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { MessageCircle, X, Zap, TrendingDown, Navigation, Send } from 'lucide-react';

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

/** ---------- Mock Stops ---------- */
const busStops: BusStop[] = [
  { id: 1, name: 'A', lat: 40.002, lng: -83.010 },
  { id: 2, name: 'B', lat: 40.002, lng: -83.007 },
  { id: 3, name: 'C', lat: 40.005, lng: -83.003 },
  { id: 4, name: 'D', lat: 40.009, lng: -83.005 },
  { id: 5, name: 'E', lat: 40.009, lng: -83.008 },
  { id: 6, name: 'F', lat: 40.013, lng: -83.010 },
  { id: 7, name: 'G', lat: 40.007, lng: -83.012 },
];

/** ---------- Helpers for "along a path" placement ---------- */
function segLen(a: {lat:number;lng:number}, b:{lat:number;lng:number}) {
  // small area → Euclidean in degrees is fine
  const dLat = b.lat - a.lat;
  const dLng = b.lng - a.lng;
  return Math.hypot(dLat, dLng);
}

function buildSegments(stops: BusStop[]) {
  // A -> B -> ... -> G (no loop back to A)
  const segs: Array<{a: BusStop; b: BusStop; len: number}> = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    segs.push({ a, b, len: segLen(a, b) });
  }
  return segs;
}

function interpolate(a:{lat:number;lng:number}, b:{lat:number;lng:number}, t:number) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

function pointAlongPath(stops: BusStop[], t: number) {
  // t in [0,1] along A->...->G
  const segs = buildSegments(stops);
  const total = segs.reduce((s, seg) => s + seg.len, 0);
  let dist = t * total;

  for (const seg of segs) {
    if (dist <= seg.len) {
      const f = seg.len === 0 ? 0 : dist / seg.len;
      return interpolate(seg.a, seg.b, f);
    }
    dist -= seg.len;
  }
  // numerical edge: return last stop
  const last = stops[stops.length - 1];
  return { lat: last.lat, lng: last.lng };
}

function nearestStop(pos: {lat:number;lng:number}, stops: BusStop[]) {
  let best = stops[0];
  let bestD = Infinity;
  for (const s of stops) {
    const d = segLen(pos, s);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

/** ---------- Mock Buses (4 weekday / 2 weekend) placed ALONG A->G ---------- */
function generateBusData(): Bus[] {
  const day = new Date().getDay(); // 0 Sun ... 6 Sat
  const isWeekend = day === 0 || day === 6;
  const busCount = isWeekend ? 2 : 4;

  // Evenly space buses along the path: t = (k+1)/(busCount+1)
  return Array.from({ length: busCount }, (_, k) => {
    const t = (k + 1) / (busCount + 1);

    // position exactly on the polyline between A and G
    const pos = pointAlongPath(busStops, t);

    // (optional) tiny jitter to avoid overlap; comment out if not desired
    // pos.lat += (Math.random() - 0.5) * 0.0004;
    // pos.lng += (Math.random() - 0.5) * 0.0004;

    const stop = nearestStop(pos, busStops);

    return {
      id: `CC-${k + 1}`,
      name: `Campus Connect ${k + 1}`,
      currentStop: stop,
      load: (['empty', 'somewhat empty', 'somewhat busy', 'busy'] as const)[
        Math.floor(Math.random() * 4)
      ],
      eta: Math.floor(Math.random() * 15) + 2,
      position: pos,
    };
  });
}


/** ---------- Load Indicator ---------- */
const LoadIndicator: React.FC<{ load: LoadLevel }> = ({ load }) => {
  const colors: Record<LoadLevel, string> = {
    'empty': 'bg-green-500',
    'somewhat empty': 'bg-yellow-400',
    'somewhat busy': 'bg-orange-500',
    'busy': 'bg-red-500',
  };
  const levels: LoadLevel[] = ['empty', 'somewhat empty', 'somewhat busy', 'busy'];
  const idx = levels.indexOf(load);

  return (
    <div className="flex gap-1 items-center">
      {levels.map((lvl, i) => (
        <div
          key={lvl}
          className={`h-3 w-8 rounded-sm ${i <= idx ? colors[load] : 'bg-gray-200'}`}
        />
      ))}
      <span className="ml-2 text-sm font-medium capitalize">{load}</span>
    </div>
  );
};

/** ---------- Cards / Panels ---------- */
const BusCard: React.FC<{ bus: Bus; onClick: () => void }> = ({ bus, onClick }) => (
  <button
    onClick={onClick}
    className="bg-white rounded-lg shadow-md p-4 mb-3 text-left hover:shadow-lg transition-shadow border-l-4 border-purple-600"
  >
    <div className="flex justify-between items-start mb-3">
      <div>
        <h3 className="font-bold text-lg text-gray-800">{bus.name}</h3>
        <p className="text-sm text-gray-600">Currently at: {bus.currentStop.name}</p>
      </div>
      <div className="text-right">
        <div className="text-purple-600 font-semibold">{bus.eta} min</div>
        <div className="text-xs text-gray-500">ETA</div>
      </div>
    </div>
    <LoadIndicator load={bus.load} />
  </button>
);

const BusStopDetail: React.FC<{
  stop: BusStop;
  buses: Bus[];
  onClose: () => void;
}> = ({ stop, buses, onClose }) => {
  const nearby = buses.filter(
    (b) => Math.abs(b.position.lat - stop.lat) < 0.002 && Math.abs(b.position.lng - stop.lng) < 0.002
  );
  return (
    <div className="bg-white rounded-xl shadow-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-bold text-xl text-gray-800">{stop.name}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <X size={22} />
        </button>
      </div>

      {nearby.length === 0 ? (
        <p className="text-gray-500 text-center py-4">No buses nearby</p>
      ) : (
        <div className="space-y-2">
          {nearby.map((bus) => (
            <div key={bus.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
              <div className="font-semibold text-gray-800">{bus.name}</div>
              <LoadIndicator load={bus.load} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// Horizontal-first Manhattan path with optional loop closure (last -> first)
function orthogonalPoints(stops: BusStop[], closeLoop: boolean = false) {
  const pts: { lat: number; lng: number }[] = [];
  if (stops.length === 0) return pts;

  // A -> B -> C ... (horizontal first, then vertical)
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    pts.push({ lat: a.lat, lng: a.lng }); // start at A
    pts.push({ lat: a.lat, lng: b.lng }); // go horizontally to B.x
    pts.push({ lat: b.lat, lng: b.lng }); // then vertically to B
  }

  // include last stop explicitly
  const last = stops[stops.length - 1];
  pts.push({ lat: last.lat, lng: last.lng });

  // OPTIONAL: close the loop (G -> A) in the same orthogonal style
  if (closeLoop && stops.length > 1) {
    const first = stops[0];
    // from G to directly above/below A (horizontal first), then down/up to A
    pts.push({ lat: last.lat, lng: first.lng }); // horizontal to A.x
    pts.push({ lat: first.lat, lng: first.lng }); // vertical to A
  }

  return pts;
}

/** ---------- Simple Map (SVG mock) with Option B polyline ---------- */
const SimpleMap: React.FC<{
  buses: Bus[];
  stops: BusStop[];
  selectedStop: BusStop | null;
  onStopSelect: (s: BusStop) => void;
}> = ({ buses, stops, selectedStop, onStopSelect }) => {
  // Dynamic bounds from stops (with padding) so everything is on-screen
  const pad = 0.0008;
  const minLat = Math.min(...stops.map(s => s.lat)) - pad;
  const maxLat = Math.max(...stops.map(s => s.lat)) + pad;
  const minLng = Math.min(...stops.map(s => s.lng)) - pad;
  const maxLng = Math.max(...stops.map(s => s.lng)) + pad;

  const latSpan = Math.max(1e-6, maxLat - minLat);
  const lngSpan = Math.max(1e-6, maxLng - minLng);

  const normLeft = (lng: number) => `${((lng - minLng) / lngSpan) * 100}%`;
  const normTop  = (lat: number) => `${((lat - minLat) / latSpan) * 100}%`;
// --------- Option B: Manhattan/orthogonal polyline (SVG) ----------
  function orthogonalPoints(sts: BusStop[]) {
    const pts: { lat: number; lng: number }[] = [];
    for (let i = 0; i < sts.length - 1; i++) {
      const a = sts[i], b = sts[i + 1];
      pts.push({ lat: a.lat, lng: a.lng }); // start
      pts.push({ lat: a.lat, lng: b.lng }); // horizontal
      pts.push({ lat: b.lat, lng: b.lng }); // vertical to next
    }
    if (sts.length) pts.push({ lat: sts.at(-1)!.lat, lng: sts.at(-1)!.lng });
    return pts;
  }
   // Build numeric 0..100 coordinates for SVG 
  const svgPoints = orthogonalPoints(stops)
    .map(p => {
      const x = ((p.lng - minLng) / lngSpan) * 100;
      const y = ((p.lat - minLat) / latSpan) * 100;
      return `${x},${y}`;
    })
    .join(' ');

   return (
    <div
      className="relative w-full bg-gradient-to-br from-purple-100 to-blue-100 rounded-lg overflow-hidden"
      style={{ height: 400 }}
    >
      {/* Route line UNDER markers */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        style={{ zIndex: 1 }}
      >
        <polyline
          points={svgPoints}
          fill="none"
          stroke="#c5b4d3ff"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>

      {/* Stops */}
      {stops.map((stop) => (
        <button
          key={stop.id}
          onClick={() => onStopSelect(stop)}
          style={{ left: normLeft(stop.lng), top: normTop(stop.lat), transform: 'translate(-50%, -50%)' }}
          className={`absolute z-20 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
            selectedStop?.id === stop.id ? 'bg-purple-600 scale-125 shadow-lg' : 'bg-white border-2 border-purple-600 hover:scale-110'
          }`}
          title={stop.name}
        >
          <span className="w-3 h-3 bg-purple-600 rounded-full" />
        </button>
      ))}

      {/* Buses */}
      {buses.map((bus) => (
        <div
          key={bus.id}
          style={{ left: normLeft(bus.position.lng), top: normTop(bus.position.lat), transform: 'translate(-50%, -50%)' }}
          className="absolute z-30 bg-purple-600 text-white rounded-lg px-2 py-1 text-xs font-bold shadow-lg animate-pulse"
          title={bus.name}
        >
          {bus.name.split(' ')[2]}
        </div>
      ))}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 bg-white rounded-lg p-3 shadow-md text-xs z-10">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 bg-purple-600 rounded" />
          <span>Active Bus</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-white border-2 border-purple-600 rounded-full" />
          <span>Bus Stop</span>
        </div>
      </div>
    </div>
  );
};

/** ---------- Chat (collapses to pill that scrolls) ---------- */
const ChatDock: React.FC<{
  expanded: boolean;
  onToggle: () => void;
}> = ({ expanded, onToggle }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');

  const shortcuts: Shortcut[] = useMemo(
    () => [
      { icon: <Navigation size={16} />,   text: 'Fastest Path', action: 'fastest' },
      { icon: <TrendingDown size={16} />, text: 'Lowest Load',  action: 'lowest'  },
      { icon: <Zap size={16} />,          text: 'Next Bus',     action: 'next'    },
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

  const handleSend = () => {
    if (!input.trim()) return;
    const lower = input.toLowerCase();
    let reply = "I'm analyzing current routes and loads. Ask me for the fastest path or lowest load.";
    if (lower.includes('fastest')) reply = 'Typical fastest CC trip is ~15–20 minutes depending on time and load.';
    if (lower.includes('load') || lower.includes('busy')) reply = 'CC-1 is somewhat busy; CC-3 is relatively empty. Want a specific stop?';
    setMessages((prev) => [...prev, { type: 'user', text: input }, { type: 'bot', text: reply }]);
    setInput('');
  };

  if (!expanded) {
    return (
      <button
        onClick={onToggle}
        className="mx-auto mt-8 mb-6 flex items-center gap-2 bg-purple-600 text-white px-4 py-3 rounded-full shadow-lg hover:bg-purple-700"
        aria-label="Open chatbot"
      >
        <MessageCircle size={20} />
        <span className="font-medium">Ask anything</span>
      </button>
    );
  }

  return (
    <div className="h-full min-h-[400px] bg-white rounded-2xl shadow-2xl flex flex-col border border-gray-200">
      <div className="bg-purple-600 text-white p-4 rounded-t-2xl flex justify-between items-center">
        <div className="flex items-center gap-2">
          <MessageCircle size={22} />
          <h3 className="font-semibold">Campus Connect Assistant</h3>
        </div>
        <button onClick={onToggle} className="hover:bg-purple-700 rounded-full p-1" aria-label="Close chatbot">
          <X size={18} />
        </button>
      </div>

      <div className="flex gap-2 p-3 bg-gray-50 border-b overflow-x-auto">
        {shortcuts.map((s) => (
          <button
            key={s.text}
            onClick={() => handleShortcut(s.action)}
            className="flex items-center gap-1 bg-white hover:bg-purple-50 text-purple-600 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap border border-purple-200 transition-colors"
          >
            {s.icon}
            {s.text}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
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
                  m.type === 'user' ? 'bg-purple-600 text-white rounded-br-none' : 'bg-gray-100 text-gray-800 rounded-bl-none'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t bg-gray-50 rounded-b-2xl">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your question..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-600"
          />
          <button onClick={handleSend} className="bg-purple-600 hover:bg-purple-700 text-white rounded-full p-2">
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

  useEffect(() => {
    setBuses(generateBusData());
    const id = setInterval(() => setBuses(generateBusData()), 10_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-1">Campus Connect</h1>
          <p className="text-gray-600">Real-time bus tracking and load monitoring</p>
          <div className="mt-2 text-sm text-gray-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>

        {/* Main Layout: switches when chatExpanded */}
        <div className={chatExpanded ? 'grid grid-cols-1 lg:grid-cols-2 gap-6 items-start' : 'grid grid-cols-1 gap-6'}>
          {/* LEFT: Map + lists */}
          <div>
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Bus Route Map</h2>
            <SimpleMap
              buses={buses}
              stops={busStops}
              selectedStop={selectedStop}
              onStopSelect={setSelectedStop}
            />

            {selectedStop && (
              <div className="mt-6">
                <BusStopDetail stop={selectedStop} buses={buses} onClose={() => setSelectedStop(null)} />
              </div>
            )}

            <div className="mt-8">
              <h2 className="text-2xl font-bold text-gray-800 mb-4">Active Buses (CC)</h2>
              <div className="grid md:grid-cols-2 gap-4">
                {buses.map((bus) => (
                  <BusCard
                    key={bus.id}
                    bus={bus}
                    onClick={() => {
                      const nearest = busStops.reduce((best, cur) => {
                        const dBest = Math.abs(best.lat - bus.position.lat) + Math.abs(best.lng - bus.position.lng);
                        const dCur = Math.abs(cur.lat - bus.position.lat) + Math.abs(cur.lng - bus.position.lng);
                        return dCur < dBest ? cur : best;
                      });
                      setSelectedStop(nearest);
                      setTimeout(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }), 0);
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Collapsed chat pill lives at the bottom of the page content and is NOT fixed */}
            {!chatExpanded && <ChatDock expanded={false} onToggle={() => setChatExpanded(true)} />}
          </div>

          {/* RIGHT: Chat column (only when expanded). Takes ~50% screen and does NOT cover the map. */}
          {chatExpanded && (
            <div className="lg:sticky lg:top-8">
              <ChatDock expanded onToggle={() => setChatExpanded(false)} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
