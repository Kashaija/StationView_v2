import React, { useState, useEffect, useRef } from 'react';
import { Clock, Package, CheckCircle, AlertTriangle, Truck, BarChart3, ChevronRight, ArrowUp, ArrowDown, Flame, X, PauseCircle, PlayCircle } from 'lucide-react';

// Lightweight storage shim to keep this file standalone even without window.storage
const storage = {
  get: async (key) => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      const value = window.localStorage.getItem(key);
      return value ? { value } : null;
    } catch (error) {
      return null;
    }
  },
  set: async (key, value) => {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return;
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.error('Storage save failed', error);
    }
  }
};

// Simple ticking clock for live timers; can be paused
const useNow = (intervalMs = 1000, paused = false) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, paused]);
  return now;
};

// Station door configurations
const STATION_DOORS = {
  A: [22, 23, 24, 25, 26],
  B: [27, 28, 29, 30],
  C: [32, 33, 34, 35],
  D: [36, 37, 38, 39]
};

// Status workflow with color codes
const STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed'
};

// Color-blind friendly palette with strong contrast and secondary cues
const STATUS_COLORS = {
  pending: {
    bg: 'bg-slate-200',
    border: 'border-slate-500',
    text: 'text-slate-800',
    solid: 'bg-slate-600',
    gradient: 'from-slate-200 to-slate-300'
  },
  in_progress: {
    bg: 'bg-blue-100',
    border: 'border-blue-700',
    text: 'text-blue-800',
    solid: 'bg-blue-700',
    gradient: 'from-blue-500 to-blue-700'
  },
  completed: {
    bg: 'bg-teal-100',
    border: 'border-teal-700',
    text: 'text-teal-800',
    solid: 'bg-teal-700',
    gradient: 'from-teal-500 to-teal-700'
  }
};

const STATUS_ICONS = {
  pending: Clock,
  in_progress: Package,
  completed: CheckCircle
};

// Trailer label helper (SCAC-Trailer#)
const formatTrailerLabel = (t) => {
  if (!t) return '';
  const scac = t.company || 'UNK';
  const id = t.id || '';
  return id.startsWith(`${scac}-`) ? id : `${scac}-${id}`;
};

// Helpers
const formatDateTime = (val) => {
  if (!val) return '-';
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit' })} ${d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
};

const elapsedMsWithPause = (t, nowVal = new Date()) => {
  if (!t?.startTime) return 0;
  const start = new Date(t.startTime);
  const end = t.status === STATUS.COMPLETED && t.completedTime ? new Date(t.completedTime) : nowVal;
  const pausedAccum = t.pauseAccumulated || 0;
  const pausedNow = t.pausedAt ? Math.max(0, end - new Date(t.pausedAt)) : 0;
  return Math.max(0, end - start - pausedAccum - pausedNow);
};

const formatDuration = (t, nowVal = new Date()) => {
  if (!t?.startTime) return '-';
  const ms = elapsedMsWithPause(t, nowVal);
  const mins = Math.floor(ms / 60000);
  const secs = Math.floor((ms % 60000) / 1000)
    .toString()
    .padStart(2, '0');
  return `${mins}:${secs}`;
};

const formatDurationLive = (t) => formatDuration(t, new Date());

// Safe elapsed minutes from trailer; accounts for pauses
const elapsedMinutesFromTrailer = (t, nowVal = new Date()) => {
  if (!t?.startTime) return null;
  const ms = elapsedMsWithPause(t, nowVal);
  return Math.floor(ms / 60000);
};

// Average unload minutes for a list of completed trailers (subtract breaks by shift)
const BREAK_MIN = 57; // 7 + 20 + 30
const averageUnloadMinutes = (list, shiftName = null) => {
  const filtered = shiftName ? list.filter(t => getCurrentShift(t.startTime || t.completedTime) === shiftName) : list;
  const durations = filtered.map(t => {
    if (!t.startTime || !t.completedTime) return null;
    const ms = new Date(t.completedTime) - new Date(t.startTime);
    if (ms <= 0) return null;
    const mins = ms / 60000;
    // drop outliers longer than 8 hours; they skew averages if shift was paused overnight
    if (mins > 8 * 60) return null;
    return Math.max(0, mins - BREAK_MIN);
  }).filter(Boolean);
  if (!durations.length) return null;
  return durations.reduce((a, b) => a + b, 0) / durations.length;
};

const formatHHMM = (minsVal) => {
  if (minsVal === null || minsVal === undefined || minsVal === '-') return '-';
  const mins = Math.max(0, minsVal);
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
};

// Local date key helper (YYYY-MM-DD in local time)
const localDateKey = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

// For reporting, events before FIRST_START (6:30) count toward previous calendar day
const dayKeyForStats = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const hm = d.getHours() * 60 + d.getMinutes();
  if (hm < FIRST_START) {
    d.setDate(d.getDate() - 1);
  }
  return localDateKey(d);
};

const startOfWeekMonday = (date = new Date()) => {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun
  const diff = (day === 0 ? -6 : 1 - day); // back to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
};

// Shift helpers
// Shift definitions: First 6:30–15:00, Second 16:00–24:30 (next day), gap 15:00–16:00
const FIRST_START = 390; // minutes
const FIRST_END = 900;
const SECOND_START = 960;
const SECOND_END = 1470; // 24:30

const getCurrentShift = (nowVal = new Date()) => {
  const hm = nowVal.getHours() * 60 + nowVal.getMinutes();
  if (hm >= FIRST_START && hm < FIRST_END) return 'First';
  if (hm >= SECOND_START && hm < SECOND_END) return 'Second';
  if (hm < FIRST_START) return 'Second'; // carry-over early morning belongs to prior day's Second
  return 'Gap'; // 15:00–16:00
};

const getShiftWindow = (nowVal = new Date()) => {
  const shift = getCurrentShift(nowVal);
  const base = new Date(nowVal);
  base.setSeconds(0, 0);
  const setHM = (d, hm) => {
    const dd = new Date(d);
    const h = Math.floor(hm / 60);
    const m = hm % 60;
    dd.setHours(h, m, 0, 0);
    return dd;
  };

  if (shift === 'First') {
    return { shift: 'First', start: setHM(base, FIRST_START), end: setHM(base, FIRST_END) };
  }
  if (shift === 'Second') {
    const endDate = setHM(base, SECOND_END % 1440);
    if (SECOND_END > 1440) endDate.setDate(endDate.getDate() + 1);
    return { shift: 'Second', start: setHM(base, SECOND_START), end: endDate };
  }
  // Gap defaults to upcoming Second window
  const start = setHM(base, SECOND_START);
  const end = setHM(base, SECOND_END % 1440);
  if (SECOND_END > 1440) end.setDate(end.getDate() + 1);
  return { shift: 'Gap', start, end };
};

// Generate sample trailer data - Heavy Truck Manufacturing
const generateSampleTrailers = () => [
  { id: 'TRL-48291', company: 'ABFS', vendor: 'Magna Powertrain', commodity: 'Axle assemblies', itemCount: 42, sidCount: 6, arrived: new Date('2026-02-07T06:30:00'), priority: 1, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-9317', company: 'RDFS', vendor: 'Dana Inc', commodity: 'Driveshaft components', itemCount: 128, sidCount: 14, arrived: new Date('2026-02-08T08:15:00'), priority: 2, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-11754', company: 'YFST', vendor: 'Meritor', commodity: 'Brake modules', itemCount: 76, sidCount: 9, arrived: new Date('2026-02-08T05:00:00'), priority: 3, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-66502', company: 'YFKE', vendor: 'Cummins', commodity: 'Engine subcomponents', itemCount: 310, sidCount: 22, arrived: new Date('2026-02-09T07:20:00'), priority: 4, priorityLevel: 'Critical', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: true },
  { id: 'TRL-22984', company: 'HJBT', vendor: 'Eaton', commodity: 'Transmission housings', itemCount: 18, sidCount: 3, arrived: new Date('2026-02-10T10:45:00'), priority: 5, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-55013', company: 'ODFL', vendor: 'Bendix', commodity: 'ABS controllers', itemCount: 95, sidCount: 11, arrived: new Date('2026-02-07T04:30:00'), priority: 6, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-77401', company: 'SAIA', vendor: 'Paccar Parts', commodity: 'Steering linkages', itemCount: 64, sidCount: 7, arrived: new Date('2026-02-11T12:00:00'), priority: 7, priorityLevel: 'Low', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-39822', company: 'CWVY', vendor: 'ZF Group', commodity: 'Clutch assemblies', itemCount: 51, sidCount: 5, arrived: new Date('2026-02-06T09:30:00'), priority: 8, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-82047', company: 'ESTES', vendor: 'Bosch Rexroth', commodity: 'Hydraulic pumps', itemCount: 33, sidCount: 4, arrived: new Date('2026-02-12T08:00:00'), priority: 9, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-14409', company: 'SEFL', vendor: 'Allison Transmission', commodity: 'Torque converters', itemCount: 27, sidCount: 3, arrived: new Date('2026-02-08T06:00:00'), priority: 10, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-90388', company: 'RLCY', vendor: 'Bridgestone', commodity: 'Heavy-duty tires', itemCount: 220, sidCount: 16, arrived: new Date('2026-02-09T11:15:00'), priority: 11, priorityLevel: 'Low', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-66172', company: 'XPOE', vendor: 'ArvinMeritor', commodity: 'Suspension components', itemCount: 140, sidCount: 12, arrived: new Date('2026-02-07T03:45:00'), priority: 12, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-55731', company: 'NBME', vendor: 'TRW Automotive', commodity: 'Steering actuators', itemCount: 58, sidCount: 6, arrived: new Date('2026-02-10T09:00:00'), priority: 13, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-77204', company: 'PYLE', vendor: 'SKF', commodity: 'Wheel-end bearings', itemCount: 190, sidCount: 18, arrived: new Date('2026-02-06T13:30:00'), priority: 14, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-33918', company: 'WTIX', vendor: 'Federal-Mogul', commodity: 'Pistons & rings', itemCount: 260, sidCount: 20, arrived: new Date('2026-02-11T07:45:00'), priority: 15, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-44820', company: 'ROWY', vendor: 'Horton', commodity: 'Fan clutches', itemCount: 44, sidCount: 5, arrived: new Date('2026-02-12T10:00:00'), priority: 16, priorityLevel: 'Low', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-99014', company: 'FDXE', vendor: 'Delphi', commodity: 'Fuel system modules', itemCount: 112, sidCount: 10, arrived: new Date('2026-02-07T09:30:00'), priority: 17, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-21377', company: 'UPSA', vendor: 'Wabco', commodity: 'Air-brake valves', itemCount: 87, sidCount: 8, arrived: new Date('2026-02-09T11:00:00'), priority: 18, priorityLevel: 'High', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-60451', company: 'MLGT', vendor: 'Timken', commodity: 'Gear sets', itemCount: 72, sidCount: 7, arrived: new Date('2026-02-10T10:30:00'), priority: 19, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false },
  { id: 'TRL-88290', company: 'HLCQ', vendor: 'Parker Hannifin', commodity: 'Hydraulic lines', itemCount: 154, sidCount: 13, arrived: new Date('2026-02-11T06:00:00'), priority: 20, priorityLevel: 'Medium', status: STATUS.PENDING, assignedDoor: null, assignedStation: null, startTime: null, completedTime: null, isRush: false }
];

const CLEOStationView = () => {
  const [view, setView] = useState('team-lead');
  const [trailers, setTrailers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrailer, setSelectedTrailer] = useState(null);
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [shiftPaused, setShiftPaused] = useState(false);
  const [shiftPausedAt, setShiftPausedAt] = useState(null);
  const role = (typeof window !== 'undefined' && window.userRole) || 'lead'; // 'lead' or 'operator'

  const [now, setNow] = useState(new Date());
  const slaSnapshot = useRef({ key: null, warning: 0, overdue: 0 });
  const lastShiftEndHandled = useRef(null);
  const lastPreEndPause = useRef(null);

  const handleManualShiftEnd = () => {
    const info = getShiftWindow(now);
    const endKey = `${localDateKey(info.end)}-${info.shift}-end`;
    if (shiftPaused && shiftPausedAt) {
      recordPauseInterval(shiftPausedAt, new Date());
      setShiftPaused(false);
      setShiftPausedAt(null);
    }
    setTrailers(prev => {
      const completed = prev.filter(t => t.status === STATUS.COMPLETED);
      const remaining = prev
        .filter(t => t.status !== STATUS.COMPLETED)
        .map(t => {
          if (t.status === STATUS.IN_PROGRESS && !t.pausedAt) {
            return { ...t, pausedAt: new Date() };
          }
          return t;
        });
      appendCompletedHistory(completed, { ...info, shift: info.shift === 'Gap' ? 'Manual' : info.shift });
      return remaining;
    });
    lastShiftEndHandled.current = endKey;
  };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (!loading && trailers.length > 0) { saveData(); } }, [trailers, loading]);
  useEffect(() => {
    // persist pause state
    storage.set('cleo-shift-paused', JSON.stringify({ paused: shiftPaused, at: shiftPausedAt }));
  }, [shiftPaused, shiftPausedAt]);
  useEffect(() => {
    if (shiftPaused) return;
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [shiftPaused]);

  // Persist 45/60 minute SLA counts per day & shift for analytics history
  useEffect(() => {
    if (loading) return;
    const { warning, overdue } = calculateKPIs();
    const shift = getCurrentShift(now);
    const day = now.toISOString().slice(0, 10);
    const key = `${day}-${shift}`;
    const snapshot = slaSnapshot.current;
    if (snapshot.key === key && snapshot.warning === warning && snapshot.overdue === overdue) return;
    slaSnapshot.current = { key, warning, overdue };
    (async () => {
      try {
        const existing = await storage.get('cleo-sla-history');
        const history = existing?.value ? JSON.parse(existing.value) : [];
        const idx = history.findIndex(entry => entry.key === key);
        const record = { key, day, shift, warning, overdue, updatedAt: now.toISOString() };
        if (idx >= 0) {
          history[idx] = record;
        } else {
          history.push(record);
        }
        // keep last 60 days to prevent unbounded growth
        const trimmed = history.slice(-500);
        await storage.set('cleo-sla-history', JSON.stringify(trimmed));
      } catch (err) {
        console.error('Failed to persist SLA history', err);
      }
    })();
  }, [loading, trailers, now]);

  const loadData = async () => {
    try {
      const pausedState = await storage.get('cleo-shift-paused');
      if (pausedState?.value) {
        const parsed = JSON.parse(pausedState.value);
        setShiftPaused(!!parsed.paused);
        setShiftPausedAt(parsed.at ? new Date(parsed.at) : null);
      }
      const result = await storage.get('cleo-trailers');
      if (result && result.value) {
        const data = JSON.parse(result.value);
        const parsedData = data.map(t => ({
          ...t,
          arrived: new Date(t.arrived),
          startTime: t.startTime ? new Date(t.startTime) : null,
          completedTime: t.completedTime ? new Date(t.completedTime) : null,
          pausedAt: t.pausedAt ? new Date(t.pausedAt) : null,
          pauseAccumulated: t.pauseAccumulated || 0
        }));
        setTrailers(parsedData);
      } else {
        setTrailers(generateSampleTrailers());
      }
    } catch (error) {
      setTrailers(generateSampleTrailers());
    } finally {
      setLoading(false);
    }
  };

  const saveData = async () => {
    try {
      await storage.set('cleo-trailers', JSON.stringify(trailers));
    } catch (error) {
      console.error('Error saving data:', error);
    }
  };

const addTrailer = (trailerData) => {
  const newTrailer = {
    ...trailerData,
    id: trailerData.trailerNumber,   // <-- FIXED
    arrived: new Date(),
    priority: trailers.filter(t => t.status === STATUS.PENDING).length + 1,
    status: STATUS.PENDING,
    assignedDoor: null,
    assignedStation: null,
    startTime: null,
    completedTime: null,
    pausedAt: null,
    pauseAccumulated: 0,
    isRush: trailerData.isRush || trailerData.priorityLevel === 'Critical'
  };

  setTrailers([...trailers, newTrailer]);
};

  const addMultipleTrailers = (trailerDataArray) => {
    const existingPendingCount = trailers.filter(t => t.status === STATUS.PENDING).length;
    const newTrailers = trailerDataArray.map((data, index) => ({
      ...data,
      id: data.id || `TRL-${Math.floor(Math.random() * 900000) + 100000}`,
      arrived: data.arrived || new Date(),
      priority: existingPendingCount + index + 1,
      status: STATUS.PENDING,
      assignedDoor: null,
      assignedStation: null,
      startTime: null,
      completedTime: null,
      pausedAt: null,
      pauseAccumulated: 0,
      isRush: data.isRush || data.priorityLevel === 'Critical'
    }));
    setTrailers([...trailers, ...newTrailers]);
  };

  const assignTrailerToDoor = (trailerId, station, door) => {
    setTrailers(trailers.map(t => t.id === trailerId ? { ...t, assignedStation: station, assignedDoor: door } : t));
  };

  const updateTrailerStatus = (trailerId, newStatus) => {
    setTrailers(trailers.map(t => {
      if (t.id === trailerId) {
        const updates = { status: newStatus };
        if (newStatus === STATUS.IN_PROGRESS && !t.startTime) { updates.startTime = new Date(); updates.pauseAccumulated = 0; updates.pausedAt = null; }
        if (newStatus === STATUS.COMPLETED) {
          const nowVal = new Date();
          if (t.pausedAt) {
            updates.pauseAccumulated = (t.pauseAccumulated || 0) + Math.max(0, nowVal - new Date(t.pausedAt));
            updates.pausedAt = null;
          }
          if (!t.completedTime) { updates.completedTime = nowVal; }
        }
        return { ...t, ...updates };
      }
      return t;
    }));
  };

  const togglePause = (trailerId) => {
    const nowVal = new Date();
    setTrailers(prev => prev.map(t => {
      if (t.id !== trailerId) return t;
      if (t.pausedAt) {
        // resume
        const accumulated = (t.pauseAccumulated || 0) + Math.max(0, nowVal - new Date(t.pausedAt));
        return { ...t, pausedAt: null, pauseAccumulated: accumulated };
      } else {
        // pause
        return { ...t, pausedAt: nowVal };
      }
    }));
  };

  const toggleRush = (trailerId) => {
    setTrailers(trailers.map(t => t.id === trailerId ? { ...t, isRush: !t.isRush } : t));
  };

  const removeTrailer = (trailerId) => {
    setTrailers(trailers.filter(t => t.id !== trailerId));
  };

  const changePriority = (trailerId, direction) => {
    const trailer = trailers.find(t => t.id === trailerId);
    const pendingTrailers = trailers.filter(t => t.status === STATUS.PENDING).sort((a, b) => a.priority - b.priority);
    const currentIndex = pendingTrailers.findIndex(t => t.id === trailerId);
    if (currentIndex === -1) return;
    if (direction === 'up' && currentIndex > 0) {
      const swapTrailer = pendingTrailers[currentIndex - 1];
      setTrailers(trailers.map(t => {
        if (t.id === trailerId) return { ...t, priority: swapTrailer.priority };
        if (t.id === swapTrailer.id) return { ...t, priority: trailer.priority };
        return t;
      }));
    } else if (direction === 'down' && currentIndex < pendingTrailers.length - 1) {
      const swapTrailer = pendingTrailers[currentIndex + 1];
      setTrailers(trailers.map(t => {
        if (t.id === trailerId) return { ...t, priority: swapTrailer.priority };
        if (t.id === swapTrailer.id) return { ...t, priority: trailer.priority };
        return t;
      }));
    }
  };

  const recordPauseInterval = async (start, end) => {
    try {
      const existing = await storage.get('cleo-pause-history');
      const list = existing?.value ? JSON.parse(existing.value) : [];
      list.push({
        start: start.toISOString(),
        end: end.toISOString(),
        day: dayKeyForStats(start),
        shift: getCurrentShift(start)
      });
      const trimmed = list.slice(-500);
      await storage.set('cleo-pause-history', JSON.stringify(trimmed));
    } catch (err) {
      console.error('Failed to record pause interval', err);
    }
  };

  const pauseShift = () => {
    if (shiftPaused) return;
    const nowVal = new Date();
    setShiftPaused(true);
    setShiftPausedAt(nowVal);
  };

  const resumeShift = () => {
    if (!shiftPaused) return;
    if (shiftPausedAt) {
      recordPauseInterval(shiftPausedAt, new Date());
    }
    setShiftPaused(false);
    setShiftPausedAt(null);
  };

  const calculateKPIs = () => {
    const todayKey = localDateKey(now);
    const completed = trailers.filter(t => t.status === STATUS.COMPLETED);
    const completedToday = completed.filter(t => t.completedTime && localDateKey(t.completedTime) === todayKey);
    const inProgress = trailers.filter(t => t.status === STATUS.IN_PROGRESS);
    const warning = inProgress.filter(t => {
      const mins = elapsedMinutesFromTrailer(t, now);
      return mins !== null && mins >= 45 && mins < 60;
    }).length;
    const overdue = inProgress.filter(t => {
      const mins = elapsedMinutesFromTrailer(t, now);
      return mins !== null && mins >= 60;
    }).length;
    const rush = trailers.filter(t => t.isRush && t.status !== STATUS.COMPLETED);
    const avgUnloadTimeMins = averageUnloadMinutes(completedToday);
    const avgUnloadTime = avgUnloadTimeMins !== null ? Math.round(avgUnloadTimeMins) : null;
    const stationUtilization = {};
    Object.keys(STATION_DOORS).forEach(station => {
      const assigned = trailers.filter(t => t.assignedStation === station && t.status !== STATUS.COMPLETED);
      stationUtilization[station] = (assigned.length / STATION_DOORS[station].length) * 100;
    });
    return {
      totalTrailers: trailers.length,
      completed: completed.length,
      inProgress: inProgress.length,
      pending: trailers.filter(t => t.status === STATUS.PENDING).length,
      rush: rush.length,
      avgUnloadTime: Math.round(avgUnloadTime),
      stationUtilization,
      throughput: completed.length,
      warning,
      overdue
    };
  };

  const appendCompletedHistory = async (completedList, shiftInfo) => {
    if (!completedList.length) return;
    const todayKey = dayKeyForStats(shiftInfo?.end || new Date());
    const payload = completedList.map(t => ({
      id: t.id,
      company: t.company,
      vendor: t.vendor,
      station: t.assignedStation,
      door: t.assignedDoor,
      startTime: t.startTime ? new Date(t.startTime) : null,
      completedTime: t.completedTime ? new Date(t.completedTime) : null,
      shift: shiftInfo?.shift || getCurrentShift(t.completedTime || new Date()),
      day: todayKey
    }));
    try {
      const existing = await storage.get('cleo-completed-history');
      const list = existing?.value ? JSON.parse(existing.value) : [];
      const next = list.concat(payload).slice(-2000);
      await storage.set('cleo-completed-history', JSON.stringify(next));
    } catch (err) {
      console.error('Failed to store completed history', err);
    }
  };

  // Shift boundary effects: auto-pause 10 minutes before end; clear completed at end
  useEffect(() => {
    if (loading || shiftPaused) return;
    const info = getShiftWindow(now);
    const shiftKey = `${localDateKey(info.end)}-${info.shift}`;
    // Auto pause 10 minutes before shift end
    const pauseKey = `${shiftKey}-pause`;
    const tenMinutesMs = 10 * 60 * 1000;
    if (info.shift !== 'Gap' && info.end - now <= tenMinutesMs && info.end - now > 0 && lastPreEndPause.current !== pauseKey) {
      setTrailers(prev => prev.map(t => {
        if (t.status === STATUS.IN_PROGRESS && !t.pausedAt) {
          return { ...t, pausedAt: new Date() };
        }
        return t;
      }));
      lastPreEndPause.current = pauseKey;
    }

    // Clear completed at shift end, keep pending/in-progress
    const endKey = `${shiftKey}-end`;
    if (info.end <= now && lastShiftEndHandled.current !== endKey) {
      setTrailers(prev => {
        const completed = prev.filter(t => t.status === STATUS.COMPLETED);
        const remaining = prev.filter(t => t.status !== STATUS.COMPLETED);
        appendCompletedHistory(completed, info);
        return remaining;
      });
      lastShiftEndHandled.current = endKey;
    }
  }, [now, loading, trailers]);

  if (loading) {
    return (<div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 flex items-center justify-center"><div className="text-white text-xl">Loading CLEO Station View...</div></div>);
  }

  if (view === 'team-lead') {
    return <TeamLeadDashboard now={now} trailers={trailers} setView={setView} assignTrailerToDoor={assignTrailerToDoor} updateTrailerStatus={updateTrailerStatus} changePriority={changePriority} toggleRush={toggleRush} togglePause={togglePause} removeTrailer={removeTrailer} handleManualShiftEnd={handleManualShiftEnd} addTrailer={addTrailer} addMultipleTrailers={addMultipleTrailers} calculateKPIs={calculateKPIs} showAnalytics={showAnalytics} setShowAnalytics={setShowAnalytics} showDocs={showDocs} setShowDocs={setShowDocs} confirmAction={confirmAction} setConfirmAction={setConfirmAction} shiftPaused={shiftPaused} shiftPausedAt={shiftPausedAt} pauseShift={pauseShift} resumeShift={resumeShift} />;
  } else {
    const station = view.replace('station-', '');
    return <StationView station={station} role={role} trailers={trailers.filter(t => t.assignedStation === station)} allTrailers={trailers} setView={setView} setTrailers={setTrailers} updateTrailerStatus={updateTrailerStatus} togglePause={togglePause} confirmAction={confirmAction} setConfirmAction={setConfirmAction} shiftPaused={shiftPaused} />;
  }
};

// Team Lead Dashboard - COMPACT FOR ONE SCREEN
const TeamLeadDashboard = ({ now, trailers, setView, assignTrailerToDoor, changePriority, toggleRush, togglePause, removeTrailer, handleManualShiftEnd, addTrailer, addMultipleTrailers, calculateKPIs, showAnalytics, setShowAnalytics, showDocs, setShowDocs, confirmAction, setConfirmAction, shiftPaused, shiftPausedAt, pauseShift, resumeShift }) => {
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedTrailer, setSelectedTrailer] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedTrailers, setUploadedTrailers] = useState([]);
  const [queueFilter, setQueueFilter] = useState(STATUS.PENDING);
  const fileInputRef = React.useRef(null);
  const shift = getCurrentShift(now);
  const shiftLabel = shift === 'Gap' ? 'Shift Change' : `${shift} Shift`;
  const dayLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
  const [analyticsDate, setAnalyticsDate] = useState(() => localDateKey(new Date()));

  const kpis = calculateKPIs();
  const getStationStats = (station) => {
    const stationTrailers = trailers.filter(t => t.assignedStation === station);
    return { pending: stationTrailers.filter(t => t.status === STATUS.PENDING).length, inProgress: stationTrailers.filter(t => t.status === STATUS.IN_PROGRESS).length, completed: stationTrailers.filter(t => t.status === STATUS.COMPLETED).length, rush: stationTrailers.filter(t => t.isRush && t.status !== STATUS.COMPLETED).length };
  };
  const sortPending = (list) => {
    return list.slice().sort((a, b) => {
      const aHot = a.isRush || a.priorityLevel === 'Critical';
      const bHot = b.isRush || b.priorityLevel === 'Critical';
      const aAssigned = !!a.assignedDoor;
      const bAssigned = !!b.assignedDoor;
      // Unassigned before assigned
      if (aAssigned !== bAssigned) return aAssigned ? 1 : -1;
      // Among unassigned, HOT first
      if (aHot !== bHot) return aHot ? -1 : 1;
      // Then by numeric priority
      return (a.priority || 9999) - (b.priority || 9999);
    });
  };
  const pendingTrailers = sortPending(trailers.filter(t => t.status === STATUS.PENDING));

  const formatElapsed = (trailer) => {
    if (!trailer?.startTime) return '-';
    const ms = elapsedMsWithPause(trailer, now || new Date());
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000).toString().padStart(2, '0');
    return `${mins}:${secs}`;
  };

  // Main queue behavior:
  // - Pending tab: all pending (assigned or not), so TL sees everything; door is displayed in table
  // - Active tab: all pending + all in-progress
  // - In Progress tab: all in-progress (assigned at doors)
  // - Completed tab: all completed (history)
  const queuePending = sortPending(trailers.filter(t => t.status === STATUS.PENDING));
  const queueTrailers = (() => {
    if (queueFilter === 'active') {
      const pendingAll = queuePending;
      const inProg = trailers.filter(t => t.status === STATUS.IN_PROGRESS).sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
      return [...pendingAll, ...inProg];
    }
    if (queueFilter === STATUS.PENDING) return queuePending;
    if (queueFilter === STATUS.IN_PROGRESS) return trailers.filter(t => t.status === STATUS.IN_PROGRESS).sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    if (queueFilter === STATUS.COMPLETED) return trailers.filter(t => t.status === STATUS.COMPLETED).sort((a, b) => (b.completedTime || 0) - (a.completedTime || 0));
    return trailers;
  })();

  // no reordering in main queue per new rules
  const handleToggleRush = (trailerId) => {
    const trailer = trailers.find(t => t.id === trailerId);
    setConfirmAction({ title: trailer.isRush ? 'Remove HOT Status?' : 'Mark as HOT?', message: trailer.isRush ? `Remove rush/hot priority from ${trailer.id}?` : `Mark ${trailer.id} as HOT/RUSH priority? This trailer will be highlighted until unloading begins.`, onConfirm: () => { toggleRush(trailerId); setConfirmAction(null); }, confirmText: trailer.isRush ? 'Remove HOT' : 'Mark as HOT', confirmColor: trailer.isRush ? 'bg-gray-600 hover:bg-gray-700' : 'bg-red-600 hover:bg-red-700', icon: Flame });
  };

  const handleDeleteTrailer = (trailer) => {
    setConfirmAction({
      title: 'Remove Trailer?',
      message: `Permanently remove ${trailer.id} from the queue? This is intended for mistakenly added trailers.`,
      onConfirm: () => { removeTrailer(trailer.id); setConfirmAction(null); },
      confirmText: 'Remove',
      confirmColor: 'bg-red-600 hover:bg-red-700',
      icon: X
    });
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const name = file.name.toLowerCase();
    if (!name.endsWith('.csv')) {
      alert('Please upload a CSV file. Export the template as CSV before uploading (the .xlsx Excel file will not parse here).');
      event.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target.result;
        const rows = text
          .split(/\r?\n/)
          .map(row => row.split(',').map(cell => cell.trim()))
          .filter(r => r.some(Boolean));

        if (rows.length < 2) {
          alert('No data rows found. Make sure your CSV has a header and at least one trailer.');
          return;
        }

        const parsedTrailers = rows.slice(1).map(row => ({
          id: row[0] || `TRL-${Math.floor(Math.random() * 900000) + 100000}`,
          company: row[1] || 'Unknown',
          vendor: row[2] || 'Unknown',
          commodity: row[3] || 'Unknown',
          itemCount: parseInt(row[4]) || 0,
          sidCount: parseInt(row[5]) || 0,
          arrived: row[6] ? new Date(row[6]) : new Date(),
          priorityLevel: row[7] || 'Medium',
          isRush: (row[7] || '').toLowerCase() === 'critical'
        })).filter(t => t.id && t.company && t.vendor);

        if (parsedTrailers.length === 0) {
          alert('No valid trailer data found. Expected columns: Trailer#, SCAC, Vendor, Commodity, ItemCount, SIDCount, ArrivalDate, Priority.');
          return;
        }

        setUploadedTrailers(parsedTrailers);
        setShowUploadModal(true);
      } catch (error) {
        alert('Error parsing file. Please ensure it is a CSV with columns: Trailer#, SCAC, Vendor, Commodity, ItemCount, SIDCount, ArrivalDate, Priority.');
      }
    };
    reader.readAsText(file);
    event.target.value = ''; // Reset input
  };

  const downloadTemplate = () => {
    const template = `Trailer#,SCAC,Vendor,Commodity,ItemCount,SIDCount,ArrivalDate,Priority
TRL-12345,ABFS,Magna Powertrain,Axle assemblies,42,6,2026-02-07,High
TRL-67890,ODFL,Dana Inc,Driveshaft components,128,14,2026-02-08,Medium
TRL-54321,SAIA,Cummins,Engine subcomponents,310,22,2026-02-09,Critical`;
    
    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'trailer_upload_template.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  const confirmUpload = () => {
    addMultipleTrailers(uploadedTrailers);
    setShowUploadModal(false);
    setUploadedTrailers([]);
  };

  if (showAnalytics) {
    return (
      <div className="min-h-screen bg-gray-50 text-slate-900 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <button onClick={() => setShowAnalytics(false)} className="text-blue-600 hover:text-blue-700 mb-2 flex items-center gap-2">← Back to Dashboard</button>
            <h1 className="text-3xl font-bold">Analytics</h1>
            <p className="text-sm text-slate-600">{dayLabel} • {shiftLabel}</p>
          </div>
        </div>
        <AnalyticsPanel kpis={kpis} trailers={trailers} selectedDate={analyticsDate} onDateChange={setAnalyticsDate} />
      </div>
    );
  }

  if (showDocs) {
    return (
      <DocsPage onClose={() => setShowDocs(false)} dayLabel={dayLabel} shiftLabel={shiftLabel} />
    );
  }

  const confirmEndShift = () => {
    if (shiftPaused) return;
    setConfirmAction({
      title: 'End Shift?',
      message: 'This will archive completed unloads and clear them from the queue. Continue?',
      onConfirm: () => { handleManualShiftEnd(); setConfirmAction(null); },
      confirmText: 'End Shift',
      confirmColor: 'bg-red-600 hover:bg-red-700',
      icon: AlertTriangle
    });
  };

  return (
    <div className="h-screen bg-gray-100 text-slate-900 p-4 flex flex-col overflow-hidden relative">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-3xl font-bold text-slate-900">Cleveland TMP Receiving Dock</h2>
          <p className="text-sm text-slate-600">CLEO Station View</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-slate-900">{dayLabel}</span>
            <span className="px-2 py-1 rounded-full bg-slate-900 text-white text-xs font-semibold tracking-wide">{shiftLabel}</span>
          </div>
        </div>
          <div className="flex gap-2 flex-wrap justify-end">
            <button onClick={() => setShowDocs(true)} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-900 rounded-md text-xs font-semibold hover:bg-slate-50 flex items-center gap-1.5">📖 Help / Docs</button>
            <button onClick={() => setShowAnalytics(!showAnalytics)} className="px-3 py-1.5 bg-slate-900 text-white rounded-md text-xs font-semibold hover:bg-slate-800 flex items-center gap-1.5"><BarChart3 size={16} />{showAnalytics ? 'Hide' : 'Show'} Analytics</button>
            <button onClick={shiftPaused ? resumeShift : pauseShift} className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 ${shiftPaused ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-white border border-slate-300 text-slate-900 hover:bg-slate-50'}`}>
              {shiftPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
              {shiftPaused ? 'Resume Shift' : 'Pause Shift'}
            </button>
            <button onClick={confirmEndShift} disabled={shiftPaused} className={`px-3 py-1.5 rounded-md text-xs font-semibold ${shiftPaused ? 'bg-red-200 text-white cursor-not-allowed' : 'bg-red-600 text-white hover:bg-red-700'}`}>⏹ End Shift Now</button>
            <button onClick={downloadTemplate} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-900 rounded-md text-xs font-semibold hover:bg-slate-50" title="Download CSV Template">📋 Template</button>
            <input type="file" ref={fileInputRef} onChange={handleFileUpload} accept=".csv" className="hidden" />
            <button onClick={() => fileInputRef.current?.click()} className="px-3 py-1.5 bg-white border border-slate-300 text-slate-900 rounded-md text-xs font-semibold hover:bg-slate-50">📄 Upload</button>
          <button onClick={() => setShowAddModal(true)} className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700">+ Add Trailer</button>
        </div>
      </div>

      {shiftPaused && (
        <div className="mb-3 bg-amber-100 border border-amber-300 text-amber-900 px-3 py-2 rounded-md flex items-center justify-between z-20 relative">
          <span className="font-semibold">Shift paused {shiftPausedAt ? `since ${formatDateTime(shiftPausedAt)}` : ''}. All actions are disabled until resumed.</span>
          <button onClick={resumeShift} className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded text-xs font-semibold">Resume Shift</button>
        </div>
      )}

      <div className={`${shiftPaused ? 'pointer-events-none opacity-60' : ''}`}>
      <div className="overflow-x-auto md:overflow-visible -mx-1 pb-1">
        <div className="flex flex-nowrap md:flex-nowrap gap-2 mb-3 shrink-0 px-1 w-full md:min-w-0">
          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex-1 min-w-[120px] md:min-w-0"><Truck className="mb-1 text-slate-500" size={18} /><div className="text-xl font-bold">{kpis.totalTrailers}</div><div className="text-xs text-slate-500">Total</div></div>
          <button onClick={() => setQueueFilter(STATUS.PENDING)} className={`text-left bg-white border rounded-lg p-3 shadow-sm transition flex-1 min-w-[120px] md:min-w-0 ${queueFilter === STATUS.PENDING ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'}`}><Clock className="mb-1 text-slate-500" size={18} /><div className="text-xl font-bold">{kpis.pending}</div><div className="text-xs text-slate-500">Pending</div></button>
          <button onClick={() => setQueueFilter(STATUS.IN_PROGRESS)} className={`text-left bg-white border rounded-lg p-3 shadow-sm transition flex-1 min-w-[120px] md:min-w-0 ${queueFilter === STATUS.IN_PROGRESS ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'}`}><Package className="mb-1 text-slate-500" size={18} /><div className="text-xl font-bold">{kpis.inProgress}</div><div className="text-xs text-slate-500">In Progress</div></button>
          <button onClick={() => setQueueFilter(STATUS.COMPLETED)} className={`text-left bg-white border rounded-lg p-3 shadow-sm transition flex-1 min-w-[120px] md:min-w-0 ${queueFilter === STATUS.COMPLETED ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'}`}><CheckCircle className="mb-1 text-slate-500" size={18} /><div className="text-xl font-bold">{kpis.completed}</div><div className="text-xs text-slate-500">Completed</div></button>
          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex-1 min-w-[120px] md:min-w-0"><Flame className="mb-1 text-slate-500" size={18} /><div className="text-xl font-bold">{kpis.rush}</div><div className="text-xs text-slate-500">HOT</div></div>
          <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm flex-1 min-w-[120px] md:min-w-0"><Clock className="mb-1 text-slate-500" size={18} /><div className="text-xl font-bold">{kpis.avgUnloadTime === null ? '-' : formatHHMM(kpis.avgUnloadTime)}</div><div className="text-xs text-slate-500">Avg (hh:mm) Today</div></div>
        </div>
      </div>

      {showAnalytics && <AnalyticsPanel kpis={kpis} trailers={trailers} selectedDate={analyticsDate} onDateChange={setAnalyticsDate} />}

      <div className="mb-4 shrink-0">
        <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-1.5"><Package className="text-slate-500" size={18} />Station Overview</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
          {Object.keys(STATION_DOORS).map(station => {
            const stats = getStationStats(station);
            const active = trailers.find(t => t.assignedStation === station && t.status === STATUS.IN_PROGRESS);
            const activeMins = active ? elapsedMinutesFromTrailer(active, now) : null;
            const activityTone = activeMins === null ? 'bg-amber-100 border-amber-300' : activeMins >= 60 ? 'bg-amber-300 border-amber-500' : activeMins >= 45 ? 'bg-amber-200 border-amber-400' : 'bg-amber-100 border-amber-300';
            return (
              <div key={station} onClick={() => setView(`station-${station}`)} className="bg-white border border-slate-200 rounded-lg p-3 cursor-pointer hover:border-slate-400 transition shadow-sm">
                {stats.rush > 0 && (<div className="text-xs text-red-600 font-semibold float-right">HOT {stats.rush}</div>)}
                <div className="flex justify-between items-start mb-2">
                  <div><h3 className="text-base font-semibold text-slate-900">Station {station}</h3><p className="text-xs text-slate-500">Doors {STATION_DOORS[station].join(', ')}</p></div>
                  <ChevronRight className="text-slate-400" size={16} />
                </div>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          <div className="bg-slate-50 rounded p-1.5"><Clock className="mb-0.5 text-slate-500" size={12} /><div className="text-base font-bold">{stats.pending}</div><div className="text-xs text-slate-500">Pending</div></div>
          <div className="bg-slate-50 rounded p-1.5"><Package className="mb-0.5 text-slate-500" size={12} /><div className="text-base font-bold">{stats.inProgress}</div><div className="text-xs text-slate-500">In Progress</div></div>
          <div className="bg-slate-50 rounded p-1.5"><CheckCircle className="mb-0.5 text-slate-500" size={12} /><div className="text-base font-bold">{stats.completed}</div><div className="text-xs text-slate-500">Completed</div></div>
        </div>
        {active && (
          <div className={`mt-3 px-3 py-2 rounded-md border ${activityTone} text-amber-900 flex items-center justify-between gap-2 ${active.pausedAt ? '' : 'animate-pulse'}`}>
            <div className="font-semibold text-sm">{active.pausedAt ? 'Unloading Paused' : 'Actively Unloading'}: {formatTrailerLabel(active)}</div>
            <div className="flex items-center gap-1 text-xs font-mono bg-white/70 text-amber-800 px-2 py-1 rounded">
              <Clock size={12} />
              <span>{active.pausedAt ? formatDuration(active, active.pausedAt) : formatElapsed(active)}</span>
            </div>
          </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      </div>

      <div className={`${shiftPaused ? 'pointer-events-none opacity-60' : ''} flex-1 flex flex-col min-h-0`}>
        <h2 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-1.5"><Truck className="text-slate-500" size={18} />Trailer Queue ({queueTrailers.length})</h2>
        <div className="flex-1 bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col shadow-sm">
          <div className="overflow-auto flex-1">
              {queueTrailers.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-sm">No {queueFilter.replace('_', ' ')} trailers.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-2 text-slate-700 font-semibold">#</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">Trailer #</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">SCAC</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">Vendor</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">Commodity</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">Items</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">SIDs</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">Arrived</th>
                    {queueFilter === STATUS.IN_PROGRESS && <th className="text-left p-2 text-slate-700 font-semibold">Started</th>}
                    {queueFilter === STATUS.COMPLETED && (
                      <>
                        <th className="text-left p-2 text-slate-700 font-semibold">Started</th>
                        <th className="text-left p-2 text-slate-700 font-semibold">Completed</th>
                      </>
                    )}
                    <th className="text-left p-2 text-slate-700 font-semibold">Status</th>
                    <th className="text-left p-2 text-slate-700 font-semibold">Assignment</th>
                    {queueFilter === STATUS.PENDING && <th className="text-left p-2 text-slate-700 font-semibold">Actions</th>}
                </tr>
              </thead>
              <tbody>
                  {queueTrailers.map((trailer, index) => {
                    const isCritical = trailer.priorityLevel === 'Critical';
                    const commonCells = (
                      <>
                        <td className="p-2"><div className="flex items-center gap-1">{(trailer.isRush || isCritical) && <Flame className="text-red-500" size={14} />}<span className={`font-semibold ${trailer.isRush || isCritical ? 'text-red-700' : 'text-slate-900'}`}>{trailer.id}</span></div></td>
                        <td className="p-2 text-slate-700">{trailer.company}</td>
                        <td className="p-2 text-slate-700">{trailer.vendor}</td>
                        <td className="p-2 text-slate-700">{trailer.commodity}</td>
                        <td className="p-2 text-slate-700">{trailer.itemCount}</td>
                        <td className="p-2 text-slate-700">{trailer.sidCount}</td>
                        <td className="p-2 text-slate-700 whitespace-pre-line">{formatDateTime(trailer.arrived).replace(' ', '\n')}</td>
                        {queueFilter === STATUS.IN_PROGRESS && <td className="p-2 text-slate-700">{formatDateTime(trailer.startTime)}</td>}
                        {queueFilter === STATUS.COMPLETED && (
                          <>
                            <td className="p-2 text-slate-700">{formatDateTime(trailer.startTime)}</td>
                            <td className="p-2 text-slate-700">{formatDateTime(trailer.completedTime)}</td>
                          </>
                        )}
                        <td className="p-2"><StatusBadge status={trailer.status} /></td>
                        <td className="p-2 text-slate-700">{trailer.assignedDoor ? `Station ${trailer.assignedStation} - Door ${trailer.assignedDoor}` : 'Unassigned'}</td>
                      </>
                    );

                    if (queueFilter === STATUS.PENDING) {
                      return (
                        <tr key={trailer.id} className={`border-t border-slate-200 hover:bg-slate-50 transition ${trailer.isRush || isCritical ? 'bg-red-50' : ''}`}>
                          <td className="p-2 text-slate-900 font-semibold">{index + 1}</td>
                          {commonCells}
                          <td className="p-2">
                            <div className="flex gap-1">
                              <button
                                onClick={() => handleToggleRush(trailer.id)}
                                disabled={!!trailer.assignedDoor}
                                className={`px-2 py-1 rounded border text-xs font-semibold transition ${trailer.isRush || isCritical ? 'border-red-500 text-red-600 bg-red-50' : 'border-slate-300 text-slate-700 hover:bg-slate-100'} ${trailer.assignedDoor ? 'opacity-50 cursor-not-allowed hover:bg-transparent' : ''}`}
                              >
                                <Flame size={12} />
                              </button>
                              <button
                                onClick={() => { setSelectedTrailer(trailer); setShowAssignModal(true); }}
                                disabled={!!trailer.assignedDoor}
                                className={`px-2 py-1 bg-slate-900 hover:bg-slate-800 text-white rounded font-semibold transition ${trailer.assignedDoor ? 'opacity-50 cursor-not-allowed hover:bg-slate-900' : ''}`}
                              >
                                Assign
                              </button>
                              <button
                                onClick={() => handleDeleteTrailer(trailer)}
                                className="px-2 py-1 border border-slate-300 text-slate-700 hover:bg-red-50 hover:text-red-700 rounded text-xs font-semibold"
                              >
                                Remove
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    return (
                      <tr key={trailer.id} className={`border-t border-slate-200 hover:bg-slate-50 transition ${trailer.isRush || isCritical ? 'bg-red-50' : ''}`}>
                        <td className="p-2 text-slate-900 font-semibold">{index + 1}</td>
                        {commonCells}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {showAssignModal && selectedTrailer && <AssignmentModal trailer={selectedTrailer} onClose={() => { setShowAssignModal(false); setSelectedTrailer(null); }} onAssign={assignTrailerToDoor} trailers={trailers} />}
      {showAddModal && <AddTrailerModal onClose={() => setShowAddModal(false)} onAdd={addTrailer} />}
      {showUploadModal && <UploadConfirmationModal trailers={uploadedTrailers} onClose={() => { setShowUploadModal(false); setUploadedTrailers([]); }} onConfirm={confirmUpload} />}
      {confirmAction && <ConfirmationModal isOpen={true} onClose={() => setConfirmAction(null)} onConfirm={confirmAction.onConfirm} title={confirmAction.title} message={confirmAction.message} confirmText={confirmAction.confirmText} confirmColor={confirmAction.confirmColor} icon={confirmAction.icon} />}
    </div>
  );
};

// Station View Component
const StationView = ({ station, role = 'lead', trailers, allTrailers, setView, setTrailers, updateTrailerStatus, togglePause, confirmAction, setConfirmAction, shiftPaused }) => {
  const hasActive = trailers.some(t => t.status === STATUS.IN_PROGRESS);
  const [filter, setFilter] = useState(hasActive ? STATUS.IN_PROGRESS : STATUS.PENDING);
  const doors = STATION_DOORS[station];
  const doorAssignments = {};
  doors.forEach(door => { doorAssignments[door] = allTrailers.find(t => t.assignedDoor === door && t.status !== STATUS.COMPLETED); });
  const stats = { pending: trailers.filter(t => t.status === STATUS.PENDING).length, inProgress: trailers.filter(t => t.status === STATUS.IN_PROGRESS).length, completed: trailers.filter(t => t.status === STATUS.COMPLETED).length, rush: trailers.filter(t => t.isRush && t.status !== STATUS.COMPLETED).length };
  const ordered = trailers.slice().sort((a, b) => (a.stationOrder ?? a.priority ?? 9999) - (b.stationOrder ?? b.priority ?? 9999));
  const filteredTrailers = (() => {
    if (filter === 'active') return ordered.filter(t => t.status !== STATUS.COMPLETED);
    if (filter === STATUS.PENDING) return ordered.filter(t => t.status === STATUS.PENDING);
    if (filter === STATUS.IN_PROGRESS) return ordered.filter(t => t.status === STATUS.IN_PROGRESS);
    if (filter === STATUS.COMPLETED) return ordered.filter(t => t.status === STATUS.COMPLETED);
    return ordered;
  })();

  const isTeamLead = role === 'lead';

  useEffect(() => {
    if (filter === STATUS.IN_PROGRESS && stats.inProgress === 0 && stats.pending > 0) {
      setFilter(STATUS.PENDING);
    }
  }, [filter, stats.inProgress, stats.pending]);

  const reorderStation = (trailerId, direction) => {
    if (!isTeamLead) return;
    setTrailers(prev => {
      const next = [...prev];
      const stationList = next.filter(t => t.assignedStation === station && t.status !== STATUS.COMPLETED).sort((a, b) => (a.stationOrder ?? a.priority ?? 9999) - (b.stationOrder ?? b.priority ?? 9999));
      const idx = stationList.findIndex(t => t.id === trailerId);
      if (idx === -1) return prev;
      const swapWith = direction === 'up' ? idx - 1 : idx + 1;
      if (swapWith < 0 || swapWith >= stationList.length) return prev;
      [stationList[idx], stationList[swapWith]] = [stationList[swapWith], stationList[idx]];
      stationList.forEach((t, i) => { const real = next.find(p => p.id === t.id); if (real) real.stationOrder = i + 1; });
      return next;
    });
  };
  const handleStatusChange = (trailerId, newStatus, trailer) => {
    if (newStatus === STATUS.IN_PROGRESS) {
      const active = allTrailers.find(t => t.assignedStation === station && t.status === STATUS.IN_PROGRESS);
      if (active && active.id !== trailer.id) {
        setConfirmAction({
          title: 'Station Busy',
          message: `Station ${station} is already unloading trailer ${active.id}. Complete it before starting ${trailer.id}.`,
          onConfirm: () => setConfirmAction(null),
          confirmText: 'Close',
          confirmColor: 'bg-slate-700 hover:bg-slate-600',
          icon: AlertTriangle
        });
        return;
      }
    }
    const statusLabels = { [STATUS.IN_PROGRESS]: 'start unloading', [STATUS.COMPLETED]: 'mark as completed' };
    setConfirmAction({ title: `Confirm Status Change`, message: `Are you sure you want to ${statusLabels[newStatus]} trailer ${trailer.id}?`, onConfirm: () => { updateTrailerStatus(trailerId, newStatus); setConfirmAction(null); }, confirmText: 'Confirm', confirmColor: newStatus === STATUS.COMPLETED ? 'bg-green-600 hover:bg-green-700' : 'bg-blue-600 hover:bg-blue-700', icon: newStatus === STATUS.COMPLETED ? CheckCircle : Package });
  };

  return (
    <div className="h-screen bg-gray-50 text-slate-900 p-5 flex flex-col overflow-hidden relative">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>{isTeamLead && <button onClick={() => setView('team-lead')} className="text-blue-600 hover:text-blue-700 mb-1 flex items-center gap-2 text-sm">← Back to Dashboard</button>}<h1 className="text-3xl font-bold text-slate-900 mb-1">Station {station}</h1><p className="text-slate-600 text-base">Doors {doors.join(', ')}</p></div>
      </div>
      <div className="overflow-x-auto md:overflow-visible -mx-1 pb-1">
        <div className={`${shiftPaused ? 'pointer-events-none opacity-60' : ''} flex flex-nowrap gap-3 mb-5 shrink-0 px-1 w-full md:min-w-0`}>
          <button onClick={() => setFilter(STATUS.PENDING)} className={`text-left bg-white border rounded-lg p-4 shadow-sm transition flex-1 min-w-[120px] md:min-w-0 ${filter === STATUS.PENDING ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'}`}><Clock className="mb-1.5 text-slate-700" size={26} /><div className="text-2xl font-bold mb-0.5">{stats.pending}</div><div className="text-slate-700 font-semibold text-sm">Pending</div></button>
          <button onClick={() => setFilter(STATUS.IN_PROGRESS)} className={`text-left bg-white border rounded-lg p-4 shadow-sm transition flex-1 min-w-[120px] md:min-w-0 ${filter === STATUS.IN_PROGRESS ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'}`}><Package className="mb-1.5 text-blue-700" size={26} /><div className="text-2xl font-bold mb-0.5 text-blue-800">{stats.inProgress}</div><div className="text-blue-800 font-semibold text-sm">In Progress</div></button>
          <button onClick={() => setFilter(STATUS.COMPLETED)} className={`text-left bg-white border rounded-lg p-4 shadow-sm transition flex-1 min-w-[120px] md:min-w-0 ${filter === STATUS.COMPLETED ? 'border-slate-900 ring-2 ring-slate-200' : 'border-slate-200 hover:border-slate-300'}`}><CheckCircle className="mb-1.5 text-teal-700" size={26} /><div className="text-2xl font-bold mb-0.5 text-teal-800">{stats.completed}</div><div className="text-teal-800 font-semibold text-sm">Completed</div></button>
          <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex-1 min-w-[120px] md:min-w-0"><Flame className="mb-1.5 text-slate-700" size={26} /><div className="text-2xl font-bold mb-0.5">{stats.rush}</div><div className="text-slate-700 font-semibold text-sm">HOT</div></div>
        </div>
      </div>
      <div className={`${shiftPaused ? 'pointer-events-none opacity-60' : ''} mb-5 shrink-0`}>
        <h2 className="text-2xl font-bold text-slate-900 mb-4">My Doors</h2>
        <div className="overflow-x-auto md:overflow-visible -mx-1 pb-1">
          <div className="flex flex-nowrap md:flex-wrap gap-3 px-1 w-full md:min-w-0">
            {doors.map(door => {
              const assignment = doorAssignments[door];
              const isInProgress = assignment?.status === STATUS.IN_PROGRESS;
              const isRush = assignment?.isRush;
              return (
                <div key={door} className={`rounded-lg p-4 border transition flex-1 min-w-[140px] md:min-w-0 max-w-[200px] ${isInProgress ? 'border-blue-500 bg-blue-50' : assignment ? 'border-slate-200 bg-white' : 'border-dashed border-slate-300 bg-slate-50'}`}>
                  <div className="text-lg font-semibold mb-1 text-slate-900">Door {door}</div>
                  {assignment ? (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Truck className={isInProgress ? 'text-blue-600' : isRush ? 'text-red-500' : 'text-slate-500'} size={22} />
                        {isRush && <Flame className="text-red-500" size={16} />}
                      </div>
                      <div className="font-semibold text-slate-900 mb-1">{formatTrailerLabel(assignment)}</div>
                      {isInProgress && (<div className="mt-2 px-2 py-1 bg-blue-600 text-white rounded text-xs font-semibold inline-block">UNLOADING</div>)}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-500">No trailer</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className={`${shiftPaused ? 'pointer-events-none opacity-60' : ''} flex gap-2 mb-3 shrink-0`}>{[{ key: 'active', label: 'Active', count: stats.pending + stats.inProgress }, { key: STATUS.PENDING, label: 'Pending', count: stats.pending }, { key: STATUS.IN_PROGRESS, label: 'In Progress', count: stats.inProgress }, { key: STATUS.COMPLETED, label: 'Completed', count: stats.completed }].map(tab => (<button key={tab.key} onClick={() => setFilter(tab.key)} className={`px-4 py-2 rounded-md border text-sm font-semibold transition ${filter === tab.key ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}>{tab.label} ({tab.count})</button>))}</div>
      <div className={`${shiftPaused ? 'pointer-events-none opacity-60' : ''} flex-1 min-h-0 overflow-auto space-y-2`}>{filteredTrailers.length === 0 ? (<div className="bg-white rounded-lg border border-slate-200 p-8 text-center"><CheckCircle className="mx-auto mb-4 text-slate-400" size={48} /><div className="text-slate-600 text-lg">No {filter !== 'all' ? filter.replace('_', ' ') : ''} items</div></div>) : (filteredTrailers.map((trailer, idx) => (<TrailerCard key={trailer.id} trailer={trailer} onUpdateStatus={(id, status) => handleStatusChange(id, status, trailer)} onTogglePause={() => togglePause(trailer.id)} highlightActive canReorder={isTeamLead && trailer.status !== STATUS.COMPLETED} onMoveUp={() => reorderStation(trailer.id, 'up')} onMoveDown={() => reorderStation(trailer.id, 'down')} isTop={idx === 0} isBottom={idx === filteredTrailers.length - 1} shiftPaused={shiftPaused} compact />)))}</div>
      {shiftPaused && (
        <div className="absolute inset-0 bg-slate-200/60 backdrop-blur-[2px] flex items-center justify-center pointer-events-auto">
          <div className="bg-white shadow-lg rounded-lg px-5 py-4 border border-slate-300 text-slate-800 text-center">
            <div className="font-bold mb-1">Shift is paused</div>
            <div className="text-sm text-slate-600">Resume from the Team Lead dashboard.</div>
          </div>
        </div>
      )}
      {confirmAction && <ConfirmationModal isOpen={true} onClose={() => setConfirmAction(null)} onConfirm={confirmAction.onConfirm} title={confirmAction.title} message={confirmAction.message} confirmText={confirmAction.confirmText} confirmColor={confirmAction.confirmColor} icon={confirmAction.icon} />}
      </div>
  );
};

// Supporting Components
const StatusBadge = ({ status }) => {
  const colors = STATUS_COLORS[status];
  const labels = { [STATUS.PENDING]: 'Pending', [STATUS.IN_PROGRESS]: 'In Progress', [STATUS.COMPLETED]: 'Completed' };
  const Icon = STATUS_ICONS[status] || Clock;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${colors.bg} ${colors.border} ${colors.text}`}>
      <Icon size={12} />
      {labels[status]}
    </span>
  );
};

const TrailerCard = ({ trailer, onUpdateStatus, onTogglePause, highlightActive = false, canReorder = false, onMoveUp, onMoveDown, isTop = false, isBottom = false, shiftPaused = false, compact = false }) => {
  const canStart = trailer.status === STATUS.PENDING;
  const canComplete = trailer.status === STATUS.IN_PROGRESS;
  const isInProgress = trailer.status === STATUS.IN_PROGRESS;
  const isPaused = !!trailer.pausedAt;
  const isRush = trailer.isRush && trailer.status !== STATUS.COMPLETED;
  const isCritical = trailer.priorityLevel === 'Critical';
  const now = useNow(1000, shiftPaused);
  const elapsedLabel = (() => {
    if (!isInProgress || !trailer.startTime) return null;
    const ms = elapsedMsWithPause({ ...trailer, status: trailer.status, pausedAt: isPaused ? trailer.pausedAt : null }, isPaused ? trailer.pausedAt : now);
    const mins = Math.floor(ms / 60000);
    const secs = Math.floor((ms % 60000) / 1000)
      .toString()
      .padStart(2, '0');
    return `${mins}:${secs}`;
  })();
  return (
    <div className={`rounded-lg border transition ${compact ? 'p-3 min-h-[150px]' : 'p-4'} ${isInProgress ? 'border-blue-500 bg-blue-50' : isRush || isCritical ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex justify-between items-start mb-2">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2"><Truck className={isInProgress ? 'text-blue-600' : isRush || isCritical ? 'text-red-500' : 'text-slate-500'} size={compact ? 22 : isInProgress ? 28 : 24} /><h3 className={`font-bold ${compact ? 'text-base' : 'text-lg'} text-slate-900 ${highlightActive && isInProgress ? 'animate-pulse' : ''}`}>{formatTrailerLabel(trailer)}</h3><StatusBadge status={trailer.status} />{(isRush || isCritical) && <Flame className="text-red-500" size={18} />}</div>
          <div className={`${compact ? 'text-sm' : 'text-base'} text-slate-700 mb-1`}><span className="font-semibold">{trailer.vendor}</span></div>
        </div>
        <div className={`text-right ${compact ? 'text-xs' : 'text-sm'} text-slate-600`}><div className="font-semibold">Door {trailer.assignedDoor}</div><div>{trailer.itemCount} items</div><div className="text-xs text-slate-500">{trailer.sidCount} SIDs</div></div>
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        {canStart && (<button onClick={() => onUpdateStatus(trailer.id, STATUS.IN_PROGRESS)} className={`flex-1 ${compact ? 'px-3 py-2 text-sm' : 'px-4 py-2.5'} rounded-md font-semibold transition ${isRush || isCritical ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'}`}>{isRush || isCritical ? 'Start Unloading (HOT)' : 'Start Unloading'}</button>)}
        {isInProgress && (
          <button onClick={onTogglePause} className={`px-3 py-2 rounded-md font-semibold text-xs transition ${isPaused ? 'bg-amber-500 hover:bg-amber-600 text-white' : 'bg-slate-700 hover:bg-slate-800 text-white'}`}>
            {isPaused ? 'Resume' : 'Pause'}
          </button>
        )}
        {canComplete && (<button onClick={() => onUpdateStatus(trailer.id, STATUS.COMPLETED)} className={`flex-1 ${compact ? 'px-3 py-2 text-sm' : 'px-4 py-2.5'} bg-green-600 hover:bg-green-700 text-white rounded-md font-semibold transition`}>Mark Complete</button>)}
        {canReorder && (
          <div className="flex gap-1 ml-auto">
            <button onClick={onMoveUp} disabled={isTop} className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 disabled:opacity-40">↑</button>
            <button onClick={onMoveDown} disabled={isBottom} className="px-2 py-1 border border-slate-300 rounded text-xs text-slate-700 disabled:opacity-40">↓</button>
          </div>
        )}
      </div>
      {isInProgress && (<div className={`mt-2 border rounded-md p-2 text-center flex items-center justify-center gap-2 ${isPaused ? 'bg-amber-100 border-amber-300' : 'bg-blue-100 border-blue-300'}`}><span className={`${isPaused ? 'text-amber-800' : 'text-blue-700'} font-semibold text-xs`}>{isPaused ? 'UNLOADING PAUSED' : 'ACTIVELY UNLOADING'}</span>{elapsedLabel && <span className={`${isPaused ? 'text-amber-800' : 'text-blue-800'} font-mono text-xs px-2 py-0.5 bg-white/70 rounded`}>{elapsedLabel}</span>}</div>)}
    </div>
  );
};

const DocsPage = ({ onClose, dayLabel, shiftLabel }) => {
  const printDocs = () => window.print();

  const sections = [
    {
      id: 'exec',
      title: 'Executive Summary',
      summary: 'Why we built CLEO Station View and how it pays off.',
      points: [
        'Digital KDS for inbound trailers: live status, timers, and assignments.',
        'Solves blind spots in dock throughput, SLA breaches, and mis-assignments.',
        'ROI: fewer hot calls, faster turns, less walking to find status, automatic history + analytics.'
      ]
    },
    {
      id: 'roles',
      title: 'Roles & Permissions',
      summary: 'Who can do what.',
      points: [
        'Ops Director / Supervisor / Manager: view analytics, oversee shifts, can end shift.',
        'Team Lead: runs Main View, uploads trailers, assigns doors/stations, pause/resume/end shift.',
        'Station Operator: sees only their station, can start/pause/resume/complete a trailer, view shift completed list.'
      ]
    },
    {
      id: 'shifts',
      title: 'Shifts & Automation',
      summary: 'Shift windows and automatic behaviors.',
      points: [
        'Shifts: 6:30–15:00 (First), 16:00–24:30 (Second); auto end fires 10 minutes early.',
        'Auto pre-end: in-progress trailers auto-pause 10 minutes before end; pending remain.',
        'Pause vs End: Pause keeps everything live and blocks automation; End archives completed, clears queue except pending, pauses in-progress.'
      ]
    },
    {
      id: 'main',
      title: 'Main View (Team Lead/Supervisor)',
      summary: 'Daily control center.',
      points: [
        'Load trailers via Template → CSV Upload (columns: Trailer#, SCAC, Vendor, Commodity, ItemCount, SIDCount, ArrivalDate, Priority).',
        'HOT handling: mark/unmark; HOT stays on top until assigned; actions disabled once assigned.',
        'Assign doors/stations; one active unload per station enforced when starting.',
        'Shift controls: Pause/Resume; End Shift (confirmation).',
        'KPIs: totals, Pending/In Progress/Completed, HOT, Avg unload (hh:mm), Paused minutes.'
      ]
    },
    {
      id: 'station',
      title: 'Station View (Operator)',
      summary: 'What operators see and do.',
      points: [
        'Door tiles show current assignment (SCAC-Trailer#).',
        'One active unload per station rule enforced before start.',
        'Actions: Start, Pause/Resume, Complete; timers respect pauses.',
        'Lists: Pending, In Progress, Completed (shift only).'
      ]
    },
    {
      id: 'analytics',
      title: 'Analytics',
      summary: 'Decision support and history.',
      points: [
        'Date picker drives all KPI tiles; calendar closes after selection.',
        'Pause-time KPI per day; shift averages, SLA 45/60 counts, throughput, doors used.',
        'Week-to-date unloads by shift, station utilization gauges, hourly unloads.',
        'Historical completed/pause data retained beyond shift end.'
      ]
    },
    {
      id: 'data',
      title: 'Data & Uploads',
      summary: 'Data shape and retention.',
      points: [
        'CSV only; ensure header row matches template.',
        'Display uses SCAC-Trailer# across views (queue shows raw ID as imported).',
        'Local storage persistence; histories trimmed (~500 records) to stay performant.'
      ]
    },
    {
      id: 'troubleshoot',
      title: 'Troubleshooting',
      summary: 'Common fixes.',
      points: [
        'Blank screen: hard refresh; if still blank, restart dev server.',
        'Upload errors: confirm CSV, columns present, no empty lines.',
        'Paused state persists intentionally; resume to re-enable actions.'
      ]
    }
  ];

  const splTopics = [
    {
      id: 'spl-lead',
      name: 'Single Point Lesson: Team Lead / Supervisor',
      bullets: [
        'Load trailers: click Template to download CSV → fill required columns → Upload; confirm rows before adding.',
        'Mark HOT and assign: HOT toggles urgency; assign station/door (actions disabled once assigned).',
        'Start control: pause/resume entire shift when needed; End Shift requires confirmation and archives completions.',
        'Monitor: watch KPIs (Pending/In Progress/Completed/HOT, avg unload, paused minutes) and active unloading banners.'
      ]
    },
    {
      id: 'spl-operator',
      name: 'Single Point Lesson: Station Operator',
      bullets: [
        'Begin unload: from Pending list tap Start; system blocks if another trailer is already active at this station.',
        'Pause/Resume: use Pause when stepping away; Resume to continue the timer; Complete when floor is clear.',
        'Read tiles: Door cards show SCAC-Trailer#, status badge, and UNLOADING tag when active.',
        'Completed list: view completed trailers for this shift only (no cross-shift history in operator view).'
      ]
    },
    {
      id: 'spl-analytics',
      name: 'Single Point Lesson: Analytics (Managers)',
      bullets: [
        'Select date: date picker drives all KPI tiles; calendar closes after click.',
        'KPIs: pause-time minutes, shift averages, SLA 45/60 counts, throughput, doors used, avg unload hh:mm.',
        'Visuals: week-to-date unloads by shift, station utilization gauges, hourly unloads per shift.'
      ]
    }
  ];

  return (
    <div className="min-h-screen bg-white text-slate-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <button onClick={onClose} className="text-blue-600 hover:text-blue-700 mb-2 flex items-center gap-2">← Back to Dashboard</button>
          <h1 className="text-3xl font-bold">Help & Documentation</h1>
          <p className="text-sm text-slate-600">{dayLabel} • {shiftLabel}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={printDocs} className="px-3 py-1.5 bg-slate-900 text-white rounded-md text-xs font-semibold hover:bg-slate-800">Print / Save PDF</button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <aside className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm lg:col-span-1 h-fit">
          <h3 className="text-lg font-bold text-slate-900 mb-3">Jump to section</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            {sections.map(sec => (
              <li key={sec.id}><a href={`#${sec.id}`} className="hover:underline">{sec.title}</a></li>
            ))}
          </ul>
          <div className="mt-4 border-t border-slate-200 pt-3">
            <h4 className="font-semibold text-slate-900 text-sm mb-2">Single Point Lessons</h4>
            <ul className="text-sm text-blue-700 space-y-1">
              {splTopics.map(t => (
                <li key={t.id}><a href={`#${t.id}`} className="hover:underline">{t.name}</a></li>
              ))}
            </ul>
          </div>
        </aside>

        <div className="lg:col-span-2 space-y-4">
          {sections.map(sec => (
            <section key={sec.id} id={sec.id} className="bg-slate-50 border border-slate-200 rounded-lg p-4 shadow-sm scroll-mt-20">
              <h2 className="text-xl font-bold mb-1 text-slate-900">{sec.title}</h2>
              <p className="text-sm text-slate-600 mb-2">{sec.summary}</p>
              <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
                {sec.points.map((p, idx) => <li key={idx}>{p}</li>)}
              </ul>
            </section>
          ))}

          {splTopics.map(topic => (
            <section key={topic.id} id={topic.id} className="bg-white border border-slate-300 rounded-lg p-0 shadow-sm scroll-mt-20 overflow-hidden">
              <div className="bg-slate-900 text-white px-4 py-3 text-lg font-bold">{topic.name}</div>
              <div className="p-4 space-y-2">
                {topic.bullets.map((b, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-slate-800">
                    <span className="mt-1 w-2 h-2 rounded-full bg-slate-900"></span>
                    <p>{b}</p>
                  </div>
                ))}
                <p className="text-xs text-slate-500">Tip: capture 2–3 step screenshots or a short GIF for each bullet.</p>
              </div>
            </section>
          ))}

          <section id="downloads" className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm scroll-mt-20">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Downloads</h3>
            <ul className="list-disc list-inside text-sm text-slate-700 space-y-1">
              <li><a className="text-blue-700 hover:underline" href="#" onClick={(e) => { e.preventDefault(); alert('Use the Dashboard Template button to download the CSV.'); }}>Template CSV</a></li>
              <li><a className="text-blue-700 hover:underline" href="#" onClick={(e) => { e.preventDefault(); window.print(); }}>Printable Help (Print/PDF)</a></li>
              <li><a className="text-blue-700 hover:underline" href="#spl-lead">Single Point Lessons (see SPL sections)</a></li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};

const AssignmentModal = ({ trailer, onClose, onAssign, trailers }) => {
  const [selectedStation, setSelectedStation] = useState(null);
  const [selectedDoor, setSelectedDoor] = useState(null);
  const getAvailableDoors = (station) => { return STATION_DOORS[station].filter(door => { return !trailers.find(t => t.assignedDoor === door && t.status !== STATUS.COMPLETED); }); };
  const handleAssign = () => { if (selectedStation && selectedDoor) { onAssign(trailer.id, selectedStation, selectedDoor); onClose(); } };
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-2xl w-full border border-slate-700 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">{trailer.isRush && <Flame className="text-red-500 animate-pulse" />}Assign Trailer {formatTrailerLabel(trailer)}{trailer.isRush && <span className="text-red-400 text-lg">(HOT)</span>}</h2>
        <div className="mb-6"><label className="block text-blue-200 mb-3 font-semibold">Select Station</label><div className="grid grid-cols-4 gap-3">{Object.keys(STATION_DOORS).map(station => (<button key={station} onClick={() => { setSelectedStation(station); setSelectedDoor(null); }} className={`p-4 rounded-lg font-bold text-lg transition ${selectedStation === station ? 'bg-purple-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>Station {station}</button>))}</div></div>
        {selectedStation && (<div className="mb-6"><label className="block text-blue-200 mb-3 font-semibold">Select Door</label><div className="grid grid-cols-6 gap-3">{getAvailableDoors(selectedStation).map(door => (<button key={door} onClick={() => setSelectedDoor(door)} className={`p-4 rounded-lg font-bold transition ${selectedDoor === door ? 'bg-green-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}>{door}</button>))}</div>{getAvailableDoors(selectedStation).length === 0 && (<p className="text-yellow-400 mt-2">No available doors at this station</p>)}</div>)}
        <div className="flex gap-3 justify-end"><button onClick={onClose} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition">Cancel</button><button onClick={handleAssign} disabled={!selectedStation || !selectedDoor} className="px-6 py-3 bg-green-600 hover:bg-green-700 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-semibold transition">Assign to Door {selectedDoor || ''}</button></div>
      </div>
    </div>
  );
};

const AddTrailerModal = ({ onClose, onAdd }) => {
  const [formData, setFormData] = useState({ company: '', trailerNumber: '', vendor: '', commodity: '', itemCount: 1, sidCount: 1, priorityLevel: 'Medium', isRush: false });
  const handleSubmit = (e) => { e.preventDefault(); if (formData.company && formData.trailerNumber && formData.vendor && formData.commodity && formData.itemCount > 0 && formData.sidCount > 0) { onAdd(formData); onClose(); } };
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-lg w-full border border-slate-700 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-white mb-6">Add New Trailer</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4"><label className="block text-blue-200 mb-2 font-semibold">SCAC / Carrier</label><input type="text" value={formData.company} onChange={(e) => setFormData({ ...formData, company: e.target.value })} className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500" placeholder="e.g., ABFS, ODFL, SAIA" required /></div>

{/* Adding Trailer Number in the Form */}
<div className="mb-4">
  <label className="block text-blue-200 mb-2 font-semibold">Trailer Number</label>
  <input
    type="text"
    value={formData.trailerNumber}
    onChange={(e) =>
      setFormData({ ...formData, trailerNumber: e.target.value })
    }
    className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"
    placeholder="e.g., 532184 or ABCD123456"
    required
  />
</div>

          <div className="mb-4"><label className="block text-blue-200 mb-2 font-semibold">Vendor</label><input type="text" value={formData.vendor} onChange={(e) => setFormData({ ...formData, vendor: e.target.value })} className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500" placeholder="e.g., Magna Powertrain" required /></div>
          <div className="mb-4"><label className="block text-blue-200 mb-2 font-semibold">Commodity</label><input type="text" value={formData.commodity} onChange={(e) => setFormData({ ...formData, commodity: e.target.value })} className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500" placeholder="e.g., Axle assemblies" required /></div>
          <div className="grid grid-cols-2 gap-4 mb-4"><div><label className="block text-blue-200 mb-2 font-semibold">Item Count</label><input type="number" min="1" value={formData.itemCount} onChange={(e) => setFormData({ ...formData, itemCount: parseInt(e.target.value) })} className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500" required /></div><div><label className="block text-blue-200 mb-2 font-semibold">SID Count</label><input type="number" min="1" value={formData.sidCount} onChange={(e) => setFormData({ ...formData, sidCount: parseInt(e.target.value) })} className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500" required /></div></div>
          <div className="mb-4"><label className="block text-blue-200 mb-2 font-semibold">Priority Level</label><select value={formData.priorityLevel} onChange={(e) => setFormData({ ...formData, priorityLevel: e.target.value })} className="w-full px-4 py-3 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:border-blue-500"><option value="Low">Low</option><option value="Medium">Medium</option><option value="High">High</option><option value="Critical">Critical</option></select></div>
          <div className="mb-6"><label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={formData.isRush} onChange={(e) => setFormData({ ...formData, isRush: e.target.checked })} className="w-5 h-5 rounded border-slate-600 bg-slate-700 text-red-600 focus:ring-red-500" /><span className="text-blue-200 font-semibold flex items-center gap-2"><Flame className={formData.isRush ? 'text-red-500' : 'text-slate-500'} size={20} />Mark as HOT/RUSH Priority</span></label></div>
          <div className="flex gap-3 justify-end"><button type="button" onClick={onClose} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition">Cancel</button><button type="submit" className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition">Add Trailer</button></div>
        </form>
      </div>
    </div>
  );
};

const AnalyticsPanel = ({ kpis, trailers, selectedDate, onDateChange }) => {
  const [history, setHistory] = useState([]);
  const [completedHistory, setCompletedHistory] = useState([]);
  const [pauseHistory, setPauseHistory] = useState([]);

  const loadHistory = React.useCallback(async () => {
    try {
      const stored = await storage.get('cleo-sla-history');
      const parsed = stored?.value ? JSON.parse(stored.value) : [];
      setHistory(parsed);
    } catch (err) {
      console.error('Failed to load SLA history', err);
    }
  }, []);

  const loadCompletedHistory = React.useCallback(async () => {
    try {
      const stored = await storage.get('cleo-completed-history');
      const parsed = stored?.value ? JSON.parse(stored.value).map(r => ({
        ...r,
        startTime: r.startTime ? new Date(r.startTime) : null,
        completedTime: r.completedTime ? new Date(r.completedTime) : null
      })) : [];
      setCompletedHistory(parsed);
      return parsed;
    } catch (err) {
      console.error('Failed to load completed history', err);
      return [];
    }
  }, []);

  const loadPauseHistory = React.useCallback(async () => {
    try {
      const stored = await storage.get('cleo-pause-history');
      const parsed = stored?.value ? JSON.parse(stored.value).map(r => ({
        ...r,
        start: r.start ? new Date(r.start) : null,
        end: r.end ? new Date(r.end) : null
      })) : [];
      setPauseHistory(parsed);
    } catch (err) {
      console.error('Failed to load pause history', err);
    }
  }, []);

  const assignShift = (ts) => getCurrentShift(new Date(ts));

  useEffect(() => {
    let mounted = true;
    (async () => {
      const h = await loadHistory();
      const c = await loadCompletedHistory();
      await loadPauseHistory();
      if (!mounted) return;
    })();
    return () => { mounted = false; };
  }, [loadHistory, loadCompletedHistory, loadPauseHistory]);

  const shiftWindowsForDate = (dayKey) => {
    const dayStart = new Date(`${dayKey}T00:00:00`);
    const firstStart = new Date(dayStart); firstStart.setHours(6, 30, 0, 0);
    const firstEnd = new Date(dayStart); firstEnd.setHours(15, 0, 0, 0);
    const secondStart = new Date(dayStart); secondStart.setHours(16, 0, 0, 0);
    const secondEnd = new Date(dayStart); secondEnd.setDate(secondEnd.getDate() + 1); secondEnd.setHours(0, 30, 0, 0);
    return { firstStart, firstEnd, secondStart, secondEnd };
  };

  const inShiftWindow = (t, shiftName, dayKey) => {
    const time = t.completedTime || t.startTime;
    if (!time) return false;
    const ts = new Date(time);
    const { firstStart, firstEnd, secondStart, secondEnd } = shiftWindowsForDate(dayKey);
    if (shiftName === 'First') return ts >= firstStart && ts < firstEnd;
    if (shiftName === 'Second') return ts >= secondStart && ts < secondEnd;
    return false;
  };

  const completedForDay = (() => {
    const allRecords = [
      ...trailers.filter(t => t.status === STATUS.COMPLETED && t.completedTime),
      ...completedHistory
    ];
    const seen = new Set();
    const result = [];
    allRecords.forEach(t => {
      const key = `${t.id}-${dayKeyForStats(t.completedTime || t.startTime)}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (dayKeyForStats(t.completedTime || t.startTime) === selectedDate) {
        // ensure the time actually falls in either shift window of that date
        const { firstStart, firstEnd, secondStart, secondEnd } = shiftWindowsForDate(selectedDate);
        const time = t.completedTime || t.startTime;
        const ts = new Date(time);
        if ((ts >= firstStart && ts < firstEnd) || (ts >= secondStart && ts < secondEnd)) {
          result.push(t);
        }
      }
    });
    return result;
  })();

  const avgUnloadForDay = (() => {
    const durations = completedForDay.map(t => {
      if (!t.startTime || !t.completedTime) return null;
      const ms = new Date(t.completedTime) - new Date(t.startTime);
      return ms > 0 ? ms / 60000 : null;
    }).filter(Boolean);
    if (!durations.length) return '-';
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  })();

  const BREAK_MIN = 57; // 7 + 20 + 30
  const formatHHMM = (minsVal) => {
    if (minsVal === null || minsVal === undefined || minsVal === '-') return '-';
    const mins = Math.max(0, minsVal);
    const h = Math.floor(mins / 60).toString().padStart(2, '0');
    const m = Math.floor(mins % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };

  const avgForShift = (shiftName) => {
    const list = completedForDay.filter(t => assignShift(t.startTime || t.completedTime) === shiftName);
    const durations = list.map(t => {
      if (!t.startTime || !t.completedTime) return null;
      const ms = new Date(t.completedTime) - new Date(t.startTime);
      const mins = ms > 0 ? ms / 60000 : null;
      if (mins === null) return null;
      return Math.max(0, mins - BREAK_MIN);
    }).filter(Boolean);
    if (!durations.length) return null;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  };

  const shiftAvgFirst = avgForShift('First');
  const shiftAvgSecond = avgForShift('Second');

  const throughputForDay = completedForDay.length;
  const doorsForDay = Array.from(new Set(completedForDay.map(t => t.assignedDoor).filter(Boolean))).length;
  const computeSLAForDay = (shiftName = null) => {
    const nowVal = new Date();
    const allItems = [
      ...trailers,
      ...completedHistory
    ];
    const dateMatch = (t) => {
      const ts = t.completedTime || t.startTime;
      if (!ts) return false;
      return localDateKey(ts) === selectedDate;
    };
    const withinShift = (t) => shiftName ? inShiftWindow(t, shiftName, selectedDate) : (inShiftWindow(t, 'First', selectedDate) || inShiftWindow(t, 'Second', selectedDate));
    const minsFor = (t) => {
      if (!t.startTime) return null;
      const end = t.status === STATUS.COMPLETED ? t.completedTime : nowVal;
      const ms = elapsedMsWithPause({ ...t, completedTime: end }, end);
      return Math.floor(ms / 60000);
    };
    let warning = 0, overdue = 0;
    allItems.forEach(t => {
      if (!dateMatch(t)) return;
      if (!withinShift(t)) return;
      const m = minsFor(t);
      if (m === null) return;
      if (m >= 60) overdue += 1;
      else if (m >= 45) warning += 1;
    });
    return { warning, overdue };
  };

  const aggSLA = computeSLAForDay(null);
  const firstShiftSLA = computeSLAForDay('First');
  const secondShiftSLA = computeSLAForDay('Second');

  const completedByShift = (shiftName) => completedForDay.filter(t => inShiftWindow(t, shiftName, selectedDate));
  const calcAvgUnload = (list) => {
    const durations = list.map(t => {
      if (!t.startTime || !t.completedTime) return null;
      const ms = new Date(t.completedTime) - new Date(t.startTime);
      return ms > 0 ? ms / 60000 : null;
    }).filter(Boolean);
    if (!durations.length) return 0;
    return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
  };

  const calcAvgIdle = (list) => {
    const byStation = {};
    list.forEach(t => {
      if (!t.completedTime || !t.startTime || !t.assignedStation) return;
      const key = t.assignedStation;
      if (!byStation[key]) byStation[key] = [];
      byStation[key].push(t);
    });
    const gaps = [];
    Object.values(byStation).forEach(arr => {
      const sorted = arr.sort((a, b) => new Date(a.completedTime) - new Date(b.completedTime));
      for (let i = 0; i < sorted.length - 1; i++) {
        const nextStart = sorted[i + 1].startTime ? new Date(sorted[i + 1].startTime) : null;
        const prevDone = new Date(sorted[i].completedTime);
        if (nextStart && nextStart > prevDone) {
          gaps.push((nextStart - prevDone) / 60000);
        }
      }
    });
    if (!gaps.length) return 0;
    return Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length);
  };

  const calcTotalIdle = (list) => {
    const byStation = {};
    list.forEach(t => {
      if (!t.completedTime || !t.startTime || !t.assignedStation) return;
      const key = t.assignedStation;
      if (!byStation[key]) byStation[key] = [];
      byStation[key].push(t);
    });
    let total = 0;
    Object.values(byStation).forEach(arr => {
      const sorted = arr.sort((a, b) => new Date(a.completedTime) - new Date(b.completedTime));
      for (let i = 0; i < sorted.length - 1; i++) {
        const nextStart = sorted[i + 1].startTime ? new Date(sorted[i + 1].startTime) : null;
        const prevDone = new Date(sorted[i].completedTime);
        if (nextStart && nextStart > prevDone) {
          total += (nextStart - prevDone) / 60000;
        }
      }
    });
    const breaks = 7 + 20 + 30; // minutes
    return Math.max(0, Math.round(total - breaks));
  };

  const firstShiftList = completedByShift('First');
  const secondShiftList = completedByShift('Second');
  const shiftSummaries = [
    { label: 'First Shift', list: firstShiftList, sla: firstShift },
    { label: 'Second Shift', list: secondShiftList, sla: secondShift }
  ];

  const overlapMinutesForDate = (start, end, dateKey) => {
    if (!start || !end) return 0;
    const dayStart = new Date(dateKey + 'T00:00:00');
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const s = new Date(start);
    const e = new Date(end);
    const overlapStart = s > dayStart ? s : dayStart;
    const overlapEnd = e < dayEnd ? e : dayEnd;
    const ms = overlapEnd - overlapStart;
    return ms > 0 ? Math.floor(ms / 60000) : 0;
  };

  const pausedMinutesForDay = (() => {
    const fromHistory = pauseHistory || [];
    const minutes = fromHistory.reduce((sum, p) => sum + overlapMinutesForDate(p.start, p.end, selectedDate), 0);
    return minutes;
  })();

  // Hourly buckets per shift (0-23)
  const hourlyBuckets = (list) => {
    const buckets = {};
    list.forEach(t => {
      if (!t.completedTime) return;
      const d = new Date(t.completedTime);
      const hr = d.getHours();
      buckets[hr] = (buckets[hr] || 0) + 1;
    });
    return buckets;
  };
  const hourlyFirst = hourlyBuckets(firstShiftList);
  const hourlySecond = hourlyBuckets(secondShiftList);

  // Week-to-date series (both shifts) using synthetic + real data
  const monday = startOfWeekMonday();
  const wtd = [];
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 Sun
  const daysSinceMonday = (dayOfWeek + 6) % 7; // Mon=0
  const allCompleted = (() => {
    const merged = [];
    const seen = new Set();
    const hist = completedHistory || [];
    [...trailers.filter(t => t.status === STATUS.COMPLETED), ...hist].forEach(t => {
      const key = `${t.id}-${localDateKey(t.completedTime || t.startTime || today)}`;
      if (!seen.has(key)) { seen.add(key); merged.push(t); }
    });
    return merged;
  })();
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const key = localDateKey(d);
    const label = d.toLocaleDateString('en-US', { weekday: 'short' });
    const isFuture = i > daysSinceMonday;
    const dayList = isFuture ? [] : allCompleted.filter(t => {
      const keyVal = t.completedTime || t.startTime;
      return keyVal && dayKeyForStats(keyVal) === key;
    });
    const first = dayList.filter(t => inShiftWindow(t, 'First', key)).length;
    const second = dayList.filter(t => inShiftWindow(t, 'Second', key)).length;
    wtd.push({ key, label, first, second });
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3 shadow-sm">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-xl font-bold text-white flex items-center gap-2"><BarChart3 className="text-purple-400" size={20} />Analytics & KPIs</h2>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <span className="font-semibold">Select date:</span>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => { onDateChange(e.target.value); e.target.blur(); }}
            className="bg-white border border-slate-300 rounded px-2 py-1 text-slate-900 text-sm"
          />
        </label>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200"><div className="text-xs text-slate-500 mb-1">Completed (selected day)</div><div className="text-2xl font-bold text-slate-900">{completedForDay.length}</div></div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200"><div className="text-xs text-slate-500 mb-1">First Shift Avg Unload</div><div className="text-2xl font-bold text-slate-900">{formatHHMM(averageUnloadMinutes(completedForDay, 'First'))}</div></div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200"><div className="text-xs text-slate-500 mb-1">Second Shift Avg Unload</div><div className="text-2xl font-bold text-slate-900">{formatHHMM(averageUnloadMinutes(completedForDay, 'Second'))}</div></div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200"><div className="text-xs text-slate-500 mb-1">Throughput (selected day)</div><div className="text-2xl font-bold text-slate-900">{throughputForDay}</div></div>
        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200"><div className="text-xs text-slate-500 mb-1">Doors Utilized (selected day)</div><div className="text-2xl font-bold text-slate-900">{doorsForDay}</div></div>
        <div className="bg-indigo-50 rounded-lg p-3 border border-indigo-200"><div className="text-xs text-indigo-700 mb-1">Paused Time (selected day)</div><div className="text-2xl font-bold text-indigo-800">{formatHHMM(pausedMinutesForDay)}</div></div>
        <div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><div className="text-xs text-amber-700 mb-1">Over 45 min (selected day)</div><div className="text-2xl font-bold text-amber-700">{aggSLA.warning}</div></div>
        <div className="bg-red-50 rounded-lg p-3 border border-red-200"><div className="text-xs text-red-700 mb-1">Over 60 min (selected day)</div><div className="text-2xl font-bold text-red-700">{aggSLA.overdue}</div></div>
        <div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><div className="text-xs text-amber-700 mb-1">First Shift SLA</div><div className="text-sm text-amber-700">45+: {firstShiftSLA.warning} • 60+: {firstShiftSLA.overdue}</div></div>
        <div className="bg-amber-50 rounded-lg p-3 border border-amber-200"><div className="text-xs text-amber-700 mb-1">Second Shift SLA</div><div className="text-sm text-amber-700">45+: {secondShiftSLA.warning} • 60+: {secondShiftSLA.overdue}</div></div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="col-span-2 bg-white rounded-lg p-3 border border-slate-200 shadow-sm">
          <div className="text-slate-900 font-semibold mb-3">Week-to-date unloads by shift</div>
          <div className="flex items-end gap-3 h-52">
            {(() => {
              const maxOverall = Math.max(1, ...wtd.map(d => Math.max(d.first, d.second)));
              const barMax = 140; // px
              return wtd.map(day => {
                const hFirst = (day.first / maxOverall) * barMax;
                const hSecond = (day.second / maxOverall) * barMax;
                return (
                  <div key={day.key} className="flex-1 flex flex-col items-center gap-1">
                    <div className="flex items-end gap-2 w-full justify-center relative">
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] text-slate-700 font-bold mb-1">{day.first}</span>
                        <div className="w-6 bg-blue-500 rounded-t" style={{ height: `${hFirst}px` }} />
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[10px] text-slate-700 font-bold mb-1">{day.second}</span>
                        <div className="w-6 bg-orange-400 rounded-t" style={{ height: `${hSecond}px` }} />
                      </div>
                    </div>
                    <div className="text-xs text-slate-600">{day.label}</div>
                  </div>
                );
              });
            })()}
          </div>
          <div className="flex justify-center gap-4 mt-2 text-xs text-slate-700">
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-blue-500 inline-block" />First</span>
            <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-orange-400 inline-block" />Second</span>
          </div>
        </div>
        <div className="bg-white rounded-lg p-3 border border-slate-200 shadow-sm">
          <div className="text-slate-900 font-semibold mb-3">Station Utilization</div>
          <div className="grid grid-cols-2 gap-3">
            {Object.keys(STATION_DOORS).map(station => {
              const utilization = Math.round(kpis.stationUtilization[station] || 0);
              const angle = Math.min(100, utilization);
              return (
                <div key={station} className="bg-white border border-slate-200 rounded-lg p-2 flex flex-col items-center">
                  <div
                    className="relative w-16 h-16 rounded-full"
                    style={{
                      background: `conic-gradient(#22c55e ${angle}%, #e2e8f0 ${angle}%)`
                    }}
                  >
                    <div className="absolute inset-2 rounded-full bg-white flex items-center justify-center border border-slate-200">
                      <span className="text-slate-900 font-bold text-xs">{utilization}%</span>
                    </div>
                  </div>
                  <div className="mt-1 text-xs text-slate-900 font-semibold">Station {station}</div>
                  <div className="text-[11px] text-slate-500">Doors {STATION_DOORS[station].length}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

const ConfirmationModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = 'Confirm', confirmColor = 'bg-blue-600 hover:bg-blue-700', icon: Icon = AlertTriangle }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-8 max-w-md w-full border-2 border-slate-600 shadow-2xl">
        <div className="flex items-center gap-3 mb-4"><div className="bg-blue-500/20 rounded-full p-3"><Icon className="text-blue-400" size={32} /></div><h3 className="text-2xl font-bold text-white">{title}</h3></div>
        <p className="text-slate-300 mb-6 text-lg">{message}</p>
        <div className="flex gap-3"><button onClick={onClose} className="flex-1 px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition">Cancel</button><button onClick={onConfirm} className={`flex-1 px-6 py-3 ${confirmColor} text-white rounded-lg font-semibold transition`}>{confirmText}</button></div>
      </div>
    </div>
  );
};

const UploadConfirmationModal = ({ trailers, onClose, onConfirm }) => {
  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-2xl p-6 max-w-4xl w-full border-2 border-slate-600 shadow-2xl max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-2xl font-bold text-white">Confirm Trailer Upload</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24} /></button>
        </div>
        
        <p className="text-slate-300 mb-4">Review the {trailers.length} trailer(s) to be added:</p>
        
        <div className="flex-1 overflow-auto mb-4 bg-slate-900/50 rounded-lg border border-slate-700">
          <table className="w-full text-sm">
            <thead className="bg-slate-900 sticky top-0">
              <tr>
                <th className="text-left p-2 text-blue-200 font-semibold">Trailer #</th>
                <th className="text-left p-2 text-blue-200 font-semibold">SCAC</th>
                <th className="text-left p-2 text-blue-200 font-semibold">Vendor</th>
                <th className="text-left p-2 text-blue-200 font-semibold">Commodity</th>
                <th className="text-left p-2 text-blue-200 font-semibold">Items</th>
                <th className="text-left p-2 text-blue-200 font-semibold">SIDs</th>
                <th className="text-left p-2 text-blue-200 font-semibold">Priority</th>
              </tr>
            </thead>
            <tbody>
              {trailers.map((trailer, index) => (
                <tr key={index} className="border-t border-slate-700">
                  <td className="p-2 text-white">{formatTrailerLabel(trailer)}</td>
                  <td className="p-2 text-blue-200">{trailer.company}</td>
                  <td className="p-2 text-blue-200">{trailer.vendor}</td>
                  <td className="p-2 text-blue-200">{trailer.commodity}</td>
                  <td className="p-2 text-blue-200">{trailer.itemCount}</td>
                  <td className="p-2 text-blue-200">{trailer.sidCount}</td>
                  <td className="p-2 text-blue-200">{trailer.priorityLevel}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-6 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-semibold transition">Cancel</button>
          <button onClick={onConfirm} className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-semibold transition">Add {trailers.length} Trailer{trailers.length !== 1 ? 's' : ''}</button>
        </div>
      </div>
    </div>
  );
};

export default CLEOStationView;
