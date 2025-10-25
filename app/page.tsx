'use client';


import React, { useState, useEffect } from 'react';
import { MessageCircle, X, Zap, TrendingDown, Navigation, Send } from 'lucide-react';

// Types
interface BusStop {
  id: number;
  name: string;
  lat: number;
  lng: number;
}

interface Bus {
  id: string;
  name: string;
  currentStop: BusStop;
  load: 'empty' | 'somewhat empty' | 'somewhat busy' | 'busy';
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
  action: string;
}

// Mock data for bus stops
const busStops: BusStop[] = [
  { id: 1, name: "Student Union", lat: 40.0, lng: -83.0 },
  { id: 2, name: "Library", lat: 40.002, lng: -83.002 },
  { id: 3, name: "Recreation Center", lat: 40.004, lng: -83.004 },
  { id: 4, name: "Medical Center", lat: 40.006, lng: -83.006 },
  { id: 5, name: "Engineering Building", lat: 40.008, lng: -83.008 },
  { id: 6, name: "Dorms North", lat: 40.01, lng: -83.01 },
  { id: 7, name: "Dorms South", lat: 40.012, lng: -83.012 },
];

// Mock bus data
const generateBusData = (): Bus[] => {
  const isWeekend = new Date().getDay() === 0 || new Date().getDay() === 6;
  const busCount = isWeekend ? 2 : 4;
  
  return Array.from({ length: busCount }, (_, i) => ({
    id: `CC-${i + 1}`,
    name: `Campus Connect ${i + 1}`,
    currentStop: busStops[Math.floor(Math.random() * busStops.length)],
    load: (['empty', 'somewhat empty', 'somewhat busy', 'busy'] as const)[Math.floor(Math.random() * 4)],
    eta: Math.floor(Math.random() * 15) + 2,
    position: { 
      lat: 40.0 + (Math.random() * 0.015), 
      lng: -83.0 - (Math.random() * 0.015) 
    }
  }));
};

const LoadIndicator: React.FC<{ load: Bus['load'] }> = ({ load }) => {
  const colors: Record<Bus['load'], string> = {
    'empty': 'bg-green-500',
    'somewhat empty': 'bg-yellow-400',
    'somewhat busy': 'bg-orange-500',
    'busy': 'bg-red-500'
  };
  
  const levels: Bus['load'][] = ['empty', 'somewhat empty', 'somewhat busy', 'busy'];
  const currentLevel = levels.indexOf(load);
  
  return (
    <div className="flex gap-1 items-center">
      {levels.map((level, idx) => (
        <div
          key={level}
          className={`h-3 w-8 rounded-sm ${
            idx <= currentLevel ? colors[load] : 'bg-gray-200'
          }`}
        />
      ))}
      <span className="ml-2 text-sm font-medium capitalize">{load}</span>
    </div>
  );
};

const BusCard: React.FC<{ bus: Bus; onClick: () => void }> = ({ bus, onClick }) => {
  return (
    <div 
      onClick={onClick}
      className="bg-white rounded-lg shadow-md p-4 mb-3 cursor-pointer hover:shadow-lg transition-shadow border-l-4 border-purple-600"
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
    </div>
  );
};

const BusStopDetail: React.FC<{ stop: BusStop; buses: Bus[]; onClose: () => void }> = ({ stop, buses, onClose }) => {
  const busesAtStop = buses.filter(bus => 
    Math.abs(bus.position.lat - stop.lat) < 0.002 && 
    Math.abs(bus.position.lng - stop.lng) < 0.002
  );

  return (
    <div className="bg-white rounded-t-2xl shadow-lg p-4 max-h-64 overflow-y-auto">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-bold text-xl text-gray-800">{stop.name}</h3>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
          <X size={24} />
        </button>
      </div>
      
      {busesAtStop.length === 0 ? (
        <p className="text-gray-500 text-center py-4">No buses nearby</p>
      ) : (
        <div className="space-y-2">
          {busesAtStop.map(bus => (
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

const ChatBot: React.FC<{ isExpanded: boolean; onToggle: () => void }> = ({ isExpanded, onToggle }) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  
  const shortcuts: Shortcut[] = [
    { icon: <Navigation size={16} />, text: "Fastest Path", action: "fastest" },
    { icon: <TrendingDown size={16} />, text: "Lowest Load", action: "lowest" },
    { icon: <Zap size={16} />, text: "Next Bus", action: "next" }
  ];

  const handleShortcut = (action: string): void => {
    let response = '';
    switch(action) {
      case 'fastest':
        response = "To find the fastest path, please tell me your starting point and destination. For example: 'Fastest route from Student Union to Library'";
        break;
      case 'lowest':
        response = "Currently, buses with the lowest load are Campus Connect 2 (empty) at Recreation Center and Campus Connect 4 (somewhat empty) near Engineering Building.";
        break;
      case 'next':
        response = "The next bus arriving at Student Union will be Campus Connect 1 in approximately 3 minutes.";
        break;
    }
    const shortcut = shortcuts.find(s => s.action === action);
    setMessages([...messages, 
      { type: 'user', text: shortcut?.text || '' },
      { type: 'bot', text: response }
    ]);
  };

  const handleSend = (): void => {
    if (!inputValue.trim()) return;
    
    const newMessages: Message[] = [...messages, { type: 'user', text: inputValue }];
    
    let response = "I'm analyzing the bus routes and current loads. How else can I help you?";
    if (inputValue.toLowerCase().includes('fastest')) {
      response = "The fastest route typically takes about 15-20 minutes depending on the time of day and current traffic conditions.";
    } else if (inputValue.toLowerCase().includes('load') || inputValue.toLowerCase().includes('busy')) {
      response = "Current bus loads vary. Campus Connect 1 is somewhat busy, while Campus Connect 3 is relatively empty. Would you like more details about a specific stop?";
    }
    
    setMessages([...newMessages, { type: 'bot', text: response }]);
    setInputValue('');
  };

  if (!isExpanded) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 bg-purple-600 hover:bg-purple-700 text-white rounded-full p-4 shadow-lg transition-all flex items-center gap-2 z-50"
      >
        <MessageCircle size={24} />
        <span className="font-medium">Ask anything</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-1/2 bg-white rounded-2xl shadow-2xl flex flex-col z-50 border border-gray-200">
      <div className="bg-purple-600 text-white p-4 rounded-t-2xl flex justify-between items-center">
        <div className="flex items-center gap-2">
          <MessageCircle size={24} />
          <h3 className="font-semibold">Campus Connect Assistant</h3>
        </div>
        <button onClick={onToggle} className="hover:bg-purple-700 rounded-full p-1">
          <X size={20} />
        </button>
      </div>

      <div className="flex gap-2 p-3 bg-gray-50 border-b overflow-x-auto">
        {shortcuts.map((shortcut, idx) => (
          <button
            key={idx}
            onClick={() => handleShortcut(shortcut.action)}
            className="flex items-center gap-1 bg-white hover:bg-purple-50 text-purple-600 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap border border-purple-200 transition-colors"
          >
            {shortcut.icon}
            {shortcut.text}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 mt-8">
            <MessageCircle size={48} className="mx-auto mb-3 text-gray-300" />
            <p className="font-medium">How can I help you today?</p>
            <p className="text-sm mt-2">Ask about routes, bus loads, or ETAs</p>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.type === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[80%] p-3 rounded-2xl ${
                msg.type === 'user' 
                  ? 'bg-purple-600 text-white rounded-br-none' 
                  : 'bg-gray-100 text-gray-800 rounded-bl-none'
              }`}>
                {msg.text}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="p-4 border-t bg-gray-50 rounded-b-2xl">
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Type your question..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-purple-600"
          />
          <button
            onClick={handleSend}
            className="bg-purple-600 hover:bg-purple-700 text-white rounded-full p-2 transition-colors"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

const SimpleMap: React.FC<{ 
  buses: Bus[]; 
  stops: BusStop[]; 
  selectedStop: BusStop | null; 
  onStopSelect: (stop: BusStop) => void 
}> = ({ buses, stops, selectedStop, onStopSelect }) => {
  return (
    <div className="relative w-full bg-gradient-to-br from-purple-100 to-blue-100 rounded-lg overflow-hidden" style={{ height: '400px' }}>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 1 }}>
        <path
          d={`M ${stops.map(s => `${((s.lng + 83.0) / 0.015) * 100}%,${((s.lat - 40.0) / 0.015) * 100}%`).join(' L ')}`}
          stroke="#9333ea"
          strokeWidth="3"
          fill="none"
          strokeDasharray="5,5"
        />
      </svg>

      {stops.map(stop => (
        <button
          key={stop.id}
          onClick={() => onStopSelect(stop)}
          style={{
            position: 'absolute',
            left: `${((stop.lng + 83.0) / 0.015) * 100}%`,
            top: `${((stop.lat - 40.0) / 0.015) * 100}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 2
          }}
          className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
            selectedStop?.id === stop.id 
              ? 'bg-purple-600 scale-125 shadow-lg' 
              : 'bg-white border-2 border-purple-600 hover:scale-110'
          }`}
        >
          <div className="w-3 h-3 bg-purple-600 rounded-full"></div>
        </button>
      ))}

      {buses.map(bus => (
        <div
          key={bus.id}
          style={{
            position: 'absolute',
            left: `${((bus.position.lng + 83.0) / 0.015) * 100}%`,
            top: `${((bus.position.lat - 40.0) / 0.015) * 100}%`,
            transform: 'translate(-50%, -50%)',
            zIndex: 3
          }}
          className="bg-purple-600 text-white rounded-lg px-2 py-1 text-xs font-bold shadow-lg animate-pulse"
        >
          {bus.name.split(' ')[2]}
        </div>
      ))}

      <div className="absolute bottom-4 left-4 bg-white rounded-lg p-3 shadow-md text-xs z-10">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-4 h-4 bg-purple-600 rounded"></div>
          <span>Active Bus</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 bg-white border-2 border-purple-600 rounded-full"></div>
          <span>Bus Stop</span>
        </div>
      </div>
    </div>
  );
};

export default function CampusBusTracker() {
  const [buses, setBuses] = useState<Bus[]>([]);
  const [selectedStop, setSelectedStop] = useState<BusStop | null>(null);
  const [chatExpanded, setChatExpanded] = useState(false);

  useEffect(() => {
    setBuses(generateBusData());
    
    const interval = setInterval(() => {
      setBuses(generateBusData());
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white">
      <div className="max-w-6xl mx-auto px-4 py-8 pb-24">
        <div className="mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">Campus Connect</h1>
          <p className="text-gray-600">Real-time bus tracking and load monitoring</p>
          <div className="mt-2 text-sm text-gray-500">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </div>

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Bus Route Map</h2>
          <SimpleMap 
            buses={buses} 
            stops={busStops}
            selectedStop={selectedStop}
            onStopSelect={setSelectedStop}
          />
        </div>

        {selectedStop && (
          <div className="mb-6">
            <BusStopDetail 
              stop={selectedStop} 
              buses={buses}
              onClose={() => setSelectedStop(null)}
            />
          </div>
        )}

        <div className="mb-6">
          <h2 className="text-2xl font-bold text-gray-800 mb-4">Active Buses</h2>
          <div className="grid md:grid-cols-2 gap-4">
            {buses.map(bus => (
              <BusCard 
                key={bus.id} 
                bus={bus}
                onClick={() => {
                  const nearestStop = busStops.reduce((prev, curr) => {
                    const prevDist = Math.abs(prev.lat - bus.position.lat) + Math.abs(prev.lng - bus.position.lng);
                    const currDist = Math.abs(curr.lat - bus.position.lat) + Math.abs(curr.lng - bus.position.lng);
                    return currDist < prevDist ? curr : prev;
                  });
                  setSelectedStop(nearestStop);
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <ChatBot isExpanded={chatExpanded} onToggle={() => setChatExpanded(!chatExpanded)} />
    </div>
  );
}