
/* ============================================================================
   GUARDIAN OF THE HEARTH — Phase 6 game UI.
   Rule of the house: components dispatch actions and read selectors. Nothing
   in this file touches a service or the database directly (the Inspection
   panel's test runner runs against the separate TEST database only).
   ========================================================================== */
const { useState, useRef, useEffect, useSyncExternalStore } = React;
const G = window.GOTH;
const A = G.Actions;
const S = G.Selectors;

const TIME = { offset: 0 };
function gameNow() { return Date.now() + TIME.offset; }

/* ---- Sound: synthesized live with WebAudio — zero files, parent-mutable. ---- */
const Sfx = (function () {
  let ctx = null;
  let on = true;
  function ensure() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function blip(freq, dur, type, peak, when, slide) {
    if (!on) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak || 0.12, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }
  // filtered noise burst — for fire, impacts, whooshes
  function noise(dur, peak, when, freq, q, type) {
    if (!on) return;
    const c = ensure();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const n = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, n, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = type || 'bandpass';
    f.frequency.setValueAtTime(freq || 1200, t0); f.Q.value = q || 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak || 0.1, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(c.destination);
    s.start(t0); s.stop(t0 + dur + 0.02);
  }
  return {
    unlock: function () { ensure(); Music.sync(); },
    setOn: function (v) { on = !!v; Music.sync(); },
    isOn: function () { return on; },
    tap: function () { blip(620, 0.06, 'sine', 0.05); },
    pet: function () { blip(740, 0.1, 'sine', 0.09); blip(980, 0.12, 'sine', 0.07, 0.07); },
    submit: function () { blip(420, 0.16, 'sine', 0.1, 0, 880); },
    coin: function () { blip(1318, 0.07, 'square', 0.05); blip(1760, 0.12, 'square', 0.05, 0.06); },
    gate: function () { blip(196, 0.18, 'sine', 0.14); blip(659, 0.14, 'sine', 0.08, 0.12); blip(880, 0.2, 'sine', 0.08, 0.2); },
    raid: function () { blip(150, 0.3, 'sine', 0.2, 0, 50); blip(392, 0.12, 'triangle', 0.08, 0.18); },
    chest: function () { blip(110, 0.3, 'sawtooth', 0.06, 0, 70); blip(880, 0.1, 'sine', 0.07, 0.3); blip(1174, 0.14, 'sine', 0.07, 0.4); blip(1568, 0.22, 'sine', 0.07, 0.5); },
    achieve: function () { blip(784, 0.12, 'triangle', 0.1); blip(988, 0.12, 'triangle', 0.1, 0.1); blip(1318, 0.24, 'triangle', 0.1, 0.2); },
    levelUp: function () { blip(523, 0.12, 'triangle', 0.12); blip(659, 0.12, 'triangle', 0.12, 0.11); blip(784, 0.12, 'triangle', 0.12, 0.22); blip(1046, 0.3, 'triangle', 0.13, 0.33); },
    error: function () { blip(180, 0.12, 'square', 0.05, 0, 140); },
    growl: function () { blip(95, 0.3, 'sawtooth', 0.1, 0, 55); blip(70, 0.32, 'sawtooth', 0.08, 0.05, 50); },
    hit: function () { blip(150, 0.1, 'square', 0.2, 0, 70); blip(620, 0.05, 'square', 0.1, 0.01); },
    swish: function () { blip(700, 0.09, 'sine', 0.06, 0, 1500); },
    build: function () { blip(196, 0.05, 'square', 0.1); blip(196, 0.05, 'square', 0.1, 0.09); blip(523, 0.2, 'triangle', 0.09, 0.2); },
    crit: function () { noise(0.18, 0.22, 0, 900, 0.7, 'lowpass'); blip(180, 0.14, 'square', 0.18, 0, 60); blip(1318, 0.1, 'square', 0.1, 0.02); },
    fire: function () { noise(0.34, 0.16, 0, 1100, 0.8, 'bandpass'); noise(0.34, 0.1, 0.04, 600, 1.2, 'lowpass'); blip(220, 0.3, 'sawtooth', 0.06, 0, 90); },
    defeat: function () { blip(440, 0.5, 'sawtooth', 0.12, 0, 70); noise(0.4, 0.08, 0.1, 800, 0.6, 'lowpass'); blip(1046, 0.16, 'sine', 0.08, 0.06, 300); },
    victory: function () { var s = [523, 659, 784, 1046, 1318]; for (var i = 0; i < s.length; i++) blip(s[i], 0.26, 'triangle', 0.12, i * 0.11); blip(1568, 0.5, 'triangle', 0.12, 0.55); },
    sparkle: function () { blip(1568, 0.08, 'sine', 0.06); blip(2093, 0.1, 'sine', 0.05, 0.06); blip(2637, 0.14, 'sine', 0.05, 0.12); },
    flame: function () { blip(330, 0.3, 'sine', 0.08, 0, 660); noise(0.3, 0.06, 0, 1400, 0.9, 'bandpass'); blip(880, 0.4, 'triangle', 0.07, 0.1); },
    magic: function () { blip(523, 0.3, 'sine', 0.07, 0, 1046); blip(784, 0.3, 'sine', 0.06, 0.08, 1568); blip(1318, 0.3, 'sine', 0.05, 0.16, 2637); },
    whoosh: function () { noise(0.26, 0.12, 0, 800, 0.6, 'bandpass'); }, 
    dodge: function () { blip(880, 0.12, 'sine', 0.07, 0, 1760); noise(0.1, 0.05, 0, 2000, 1, 'highpass'); },
    _ctx: function () { return ensure(); },
  };
})();

/* ---- Music: real tracks when present, generative lullaby as fallback.
   Drop music-hearth.mp3 / music-raids.mp3 into the repo and the game uses
   them automatically — same contract as the art. ---- */
const Music = (function () {
  const TRACKS = { hearth: './music-hearth.mp3', raids: './music-raids.mp3' };
  const buffers = {};
  const loading = {};
  let playing = null;
  let scene = 'hearth';
  let wantOn = false;

  /* generative fallback (the v1.2 lullaby) */
  let fbTimer = null;
  let nextBeat = 0;
  let step = 0;
  const TEMPO = 0.86;
  const CHORDS = [
    [130.81, 196.00, 329.63],
    [110.00, 164.81, 261.63],
    [87.31, 174.61, 261.63],
    [98.00, 196.00, 293.66],
  ];
  const MELODY = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 392.00,
    523.25, 659.25, 783.99, 880.00, 783.99, 659.25, 587.33, 523.25];
  function pad(c, t0, freqs) {
    freqs.forEach(function (f, i) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = f * (i === 2 ? 1.002 : 1);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.022, t0 + 0.8);
      g.gain.linearRampToValueAtTime(0.014, t0 + TEMPO * 3.4);
      g.gain.linearRampToValueAtTime(0.0001, t0 + TEMPO * 4);
      o.connect(g);
      g.connect(c.destination);
      o.start(t0);
      o.stop(t0 + TEMPO * 4 + 0.1);
    });
  }
  function pluck(c, t0, f) {
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.9);
    o.connect(g);
    g.connect(c.destination);
    o.start(t0);
    o.stop(t0 + 1);
  }
  function crackle(c, t0) {
    const dur = 0.02 + Math.random() * 0.05;
    const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = c.createBufferSource();
    s.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 1800;
    bp.Q.value = 1.2;
    const g = c.createGain();
    g.gain.value = 0.012 + Math.random() * 0.012;
    s.connect(bp);
    bp.connect(g);
    g.connect(c.destination);
    s.start(t0);
  }
  function fbTick() {
    if (!wantOn) return;
    const c = Sfx._ctx();
    if (!c) return;
    while (nextBeat < c.currentTime + 0.35) {
      if (step % 4 === 0) pad(c, nextBeat, CHORDS[Math.floor(step / 4) % CHORDS.length]);
      const m = MELODY[step % MELODY.length];
      if (m && (step % 2 === 0 || Math.random() < 0.3)) pluck(c, nextBeat + 0.02, m);
      if (Math.random() < 0.85) crackle(c, nextBeat + Math.random() * TEMPO);
      nextBeat += TEMPO;
      step += 1;
    }
  }
  function startFallback() {
    if (fbTimer) return;
    const c = Sfx._ctx();
    if (!c) return;
    nextBeat = Math.max(nextBeat, c.currentTime + 0.1);
    fbTimer = setInterval(fbTick, 120);
    fbTick();
  }
  function stopFallback() {
    if (fbTimer) { clearInterval(fbTimer); fbTimer = null; }
  }

  /* real-track player */
  function load(name) {
    if (buffers[name] !== undefined || loading[name]) return;
    const c = Sfx._ctx();
    if (!c) return;
    loading[name] = true;
    fetch(TRACKS[name]).then(function (r) {
      if (!r.ok) throw new Error('missing');
      return r.arrayBuffer();
    }).then(function (ab) {
      return new Promise(function (res, rej) { c.decodeAudioData(ab, res, rej); });
    }).then(function (buf) {
      buffers[name] = buf;
      loading[name] = false;
      apply();
    }).catch(function () {
      buffers[name] = 'missing';
      loading[name] = false;
      apply();
    });
  }
  function stopPlaying(fade) {
    if (!playing) return;
    const c = Sfx._ctx();
    const p = playing;
    playing = null;
    const t = c.currentTime;
    p.gain.gain.cancelScheduledValues(t);
    p.gain.gain.setValueAtTime(p.gain.gain.value, t);
    p.gain.gain.linearRampToValueAtTime(0.0001, t + (fade || 0.6));
    setTimeout(function () { try { p.src.stop(); } catch (e) {} }, ((fade || 0.6) + 0.15) * 1000);
  }
  function startBuffer(name) {
    const c = Sfx._ctx();
    if (!c) return;
    const srcN = c.createBufferSource();
    srcN.buffer = buffers[name];
    srcN.loop = true;
    const g = c.createGain();
    const vol = name === 'raids' ? 0.55 : 0.42;
    g.gain.setValueAtTime(0.0001, c.currentTime);
    g.gain.linearRampToValueAtTime(vol, c.currentTime + 1.2);
    srcN.connect(g);
    g.connect(c.destination);
    srcN.start();
    playing = { name: name, src: srcN, gain: g };
  }
  function desired() {
    if (scene === 'raids' && buffers.raids && buffers.raids !== 'missing') return 'raids';
    if (buffers.hearth && buffers.hearth !== 'missing') return 'hearth';
    return null;
  }
  function apply() {
    if (!wantOn) {
      stopPlaying(0.4);
      stopFallback();
      return;
    }
    if (!Sfx._ctx()) return;
    load('hearth');
    if (scene === 'raids') load('raids');
    const want = desired();
    if (want) {
      stopFallback();
      if (playing && playing.name === want) return;
      stopPlaying(0.5);
      startBuffer(want);
    } else if (buffers.hearth === 'missing' && !playing) {
      startFallback();
    }
  }
  return {
    sync: function () {
      wantOn = Sfx.isOn() && !document.hidden;
      apply();
    },
    setScene: function (s) {
      scene = s;
      apply();
    },
  };
})();

/* Floating hearth sparks (markup built once; pure CSS does the motion). */
const SPARKS = (function () {
  const arr = [];
  for (let i = 0; i < 13; i++) {
    arr.push(
      <span key={i} style={{
        left: ((4 + i * 7.6) % 96) + '%',
        width: (4 + (i % 4)) + 'px',
        height: (4 + (i % 4)) + 'px',
        animationDelay: (i * 0.55) + 's',
        animationDuration: (4.2 + (i % 5) * 1.1) + 's',
      }} />
    );
  }
  return arr;
})();

function applyMotionPref(v) {
  document.body.classList.toggle('motion-force', v === 'on');
}

function qdDots(max, done) {
  const n = Math.min(max, 5);
  const arr = [];
  for (let i = 0; i < n; i++) arr.push(<i key={i} className={i < done ? 'on' : ''} />);
  return <span className="qd">{arr}</span>;
}

/* one place for everything that happens when a kid taps "I did it!" */
/* ---------------- read-aloud voice ---------------- */
const Voice = {
  on: false,
  chosen: '',
  ok: (typeof window !== 'undefined') && ('speechSynthesis' in window),
  list: [],
  refresh: function () {
    if (!Voice.ok) return;
    try { Voice.list = window.speechSynthesis.getVoices() || []; } catch (e) { Voice.list = []; }
  },
  score: function (v) {
    if (!v || String(v.lang || '').indexOf('en') !== 0) return -1;
    const n = String(v.name || '');
    let s = 0;
    if (/premium/i.test(n)) s += 100;
    if (/enhanced/i.test(n)) s += 80;
    if (/^(Ava|Zoe|Samantha|Allison|Nicky|Evan|Joelle|Karen|Moira|Tessa|Serena|Daniel)/i.test(n)) s += 40;
    if (v.localService) s += 10;
    if (String(v.lang || '') === 'en-US') s += 5;
    return s;
  },
  best: function () {
    Voice.refresh();
    let top = null, ts = -1;
    Voice.list.forEach(function (v) { const s = Voice.score(v); if (s > ts) { ts = s; top = v; } });
    return top;
  },
  byName: function (name) {
    if (!name) return null;
    Voice.refresh();
    for (let i = 0; i < Voice.list.length; i++) { if (Voice.list[i].name === name) return Voice.list[i]; }
    return null;
  },
  say: function (text) {
    if (!Voice.ok || !Voice.on || !text) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = Voice.byName(Voice.chosen) || Voice.best();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      u.rate = 0.92;
      u.pitch = 1.05;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  },
  stop: function () { if (Voice.ok) { try { window.speechSynthesis.cancel(); } catch (e) {} } },
  // speak() ALWAYS voices (used by Sol's welcome tutorial), regardless of the per-child toggle.
  speak: function (text, onEnd) {
    if (!Voice.ok || !text) { if (onEnd) onEnd(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const v = Voice.byName(Voice.chosen) || Voice.best();
      if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-US'; }
      u.rate = 0.86; u.pitch = 1.0; // warm, slow, grandfatherly for Sol
      if (onEnd) u.onend = onEnd;
      window.speechSynthesis.speak(u);
    } catch (e) { if (onEnd) onEnd(); }
  },
};
if (Voice.ok) {
  Voice.refresh();
  try { window.speechSynthesis.addEventListener('voiceschanged', Voice.refresh); } catch (e) {}
}

function playClip(src, fallbackText) {
  try {
    const a = new Audio(src);
    a.volume = 0.9;
    a.onerror = function () { Voice.say(fallbackText); };
    const p = a.play();
    if (p && p.catch) p.catch(function () { Voice.say(fallbackText); });
  } catch (e) { Voice.say(fallbackText); }
}

function Say(props) {
  useEffect(function () { Voice.say(props.text); }, []);
  return null;
}

function useQuestJuice(store) {
  const [sent, setSent] = useState({});
  const [ok, setOk] = useState({});
  const [bursts, setBursts] = useState([]);
  const [flights, setFlights] = useState([]);
  const [tick, setTick] = useState(0);
  async function submit(q, ev) {
    let from = null;
    if (ev && ev.currentTarget && ev.currentTarget.getBoundingClientRect) {
      const r0 = ev.currentTarget.getBoundingClientRect();
      from = { x: r0.left + r0.width / 2, y: r0.top + r0.height / 2 };
    }
    const r = await store.dispatch(A.submitQuest(q.id));
    if (!r.ok) return;
    setTick(function (t) { return t + 1; });
    // "I did it" is a BRIDGE, not a stop: guardian celebrates aloud + we mark a continuation
    // so the glow returns to the guardian instead of leaving the child on a dead screen.
    try {
      Voice.speak('Yay! You did it! Thank you for helping me!');
      sessionStorage.setItem('goth.justDidMission.v1', '1');
    } catch (e) {}
    if (from) {
      const f = {
        id: Date.now() + Math.random(), x: from.x, y: from.y,
        dx: (window.innerWidth * 0.3 - from.x) + 'px',
        dy: (window.innerHeight - 46 - from.y) + 'px',
      };
      setFlights(function (list) { return list.concat(f); });
      setTimeout(function () {
        setFlights(function (list) { return list.filter(function (x) { return x.id !== f.id; }); });
      }, 850);
    }
    Sfx.submit();
    setSent(function (s) { const n = Object.assign({}, s); n[q.id] = true; return n; });
    setTimeout(function () {
      setSent(function (s) { const n = Object.assign({}, s); delete n[q.id]; return n; });
    }, 600);
    setOk(function (s) { const n = Object.assign({}, s); n[q.id] = true; return n; });
    setTimeout(function () {
      setOk(function (s) { const n = Object.assign({}, s); delete n[q.id]; return n; });
    }, 1400);
    const items = [q.icon, '⚡', '✦', '✨'].map(function (icon, i) {
      return {
        icon: icon,
        dx: Math.round(Math.random() * 130 - 65) + 'px',
        dy: '-' + Math.round(72 + Math.random() * 60) + 'px',
        d: (i * 70) + 'ms',
      };
    });
    const burst = { id: Date.now() + Math.random(), qid: q.id, items: items };
    setBursts(function (list) { return list.concat(burst); });
    setTimeout(function () {
      setBursts(function (list) { return list.filter(function (x) { return x.id !== burst.id; }); });
    }, 1100);
  }
  return { sent: sent, ok: ok, bursts: bursts, flights: flights, tick: tick, submit: submit };
}

const PROUD_LINES = [
  '{n} is so proud of you!',
  '{n} does a happy dance!',
  '{n} cannot wait for the Keeper to see!',
  'Amazing! {n} cheers for you!',
];
function ProudMoment(props) {
  const J = props.J;
  const g = props.g;
  const [show, setShow] = useState(null);
  useEffect(function () {
    if (J.tick === 0 || !g) return;
    const line = PROUD_LINES[J.tick % PROUD_LINES.length].split('{n}').join(g.name);
    setShow({ line: line });
    Sfx.pet(); Sfx.sparkle();
    Voice.say(line + '! Sent to the Keeper!');
    const id = setTimeout(function () { setShow(null); }, 1600);
    return function () { clearTimeout(id); };
  }, [J.tick]);
  if (!show || !g) return null;
  return (
    <div className="proud" aria-live="polite">
      <div className="proud-pet">
        <Art srcs={stageArt(g.species, g.level)} emoji={speciesOf(g.species).emoji} alt={g.name} />
      </div>
      <div className="proud-text">{show.line}</div>
      <span className="emote" style={{ left: '38%' }}>❤️</span>
      <span className="emote" style={{ left: '58%', animationDelay: '0.2s' }}>✨</span>
    </div>
  );
}

function QFlights(props) {
  return (
    <React.Fragment>
      {props.J.flights.map(function (f) {
        return (
          <span key={f.id} className="flight"
            style={{ left: f.x + 'px', top: f.y + 'px', '--dx': f.dx, '--dy': f.dy }}>
            ✉️
          </span>
        );
      })}
    </React.Fragment>
  );
}

const RAID_EVENTS = [
  '{n} sniffs out a hidden path 🐾',
  'A glimmer between the stones… ✨',
  'Something rustles nearby — {n} stays brave 👀',
  '{n} hops across a mossy log 🌿',
  'A friendly firefly tags along 🧚',
  'Footprints! Treasure cannot be far 👣',
  '{n} finds a cozy resting spot 🍄',
  'The wind carries a curious tune 🎶',
  '{n} squeezes through a narrow tunnel 🕳️',
  'Shiny pebbles for the satchel 💎',
  '{n} practices a heroic pose 💪',
  'An old door creaks open slowly 🚪',
];
function raidLog(run, petName) {
  const rand = G.RNG.mulberry32(((run.seed >>> 0) + 7) >>> 0);
  const picks = [];
  const used = {};
  while (picks.length < 5) {
    const i = Math.floor(rand() * RAID_EVENTS.length);
    if (used[i]) continue;
    used[i] = true;
    picks.push(RAID_EVENTS[i].split('{n}').join(petName));
  }
  const at = [0.1, 0.28, 0.46, 0.64, 0.82];
  return picks.map(function (text, i) { return { at: at[i], text: text }; });
}

function QBurst(props) {
  return (
    <React.Fragment>
      {props.J.bursts.filter(function (x) { return x.qid === props.qid; }).map(function (br) {
        return br.items.map(function (p, i) {
          return (
            <span key={br.id + '-' + i} className="qp"
              style={{ '--dx': p.dx, '--dy': p.dy, animationDelay: p.d }}>
              {p.icon}
            </span>
          );
        });
      })}
    </React.Fragment>
  );
}

const SPECIES = [
  { id: 'FOX', name: 'Fox', pet: 'Pip', emoji: '🦊', blurb: 'clever and playful' },
  { id: 'DRAGON', name: 'Dragon', pet: 'Ember', emoji: '🐲', blurb: 'bold and brave' },
  { id: 'OWL', name: 'Owl', pet: 'Luno', emoji: '🦉', blurb: 'wise and calm' },
  { id: 'WOLF', name: 'Wolf', pet: 'Ash', emoji: '🐺', blurb: 'loyal night sentinel' },
  { id: 'TURTLE', name: 'Turtle', pet: 'Shelly', emoji: '🐢', blurb: 'patient and gentle' },
  { id: 'BEAR', name: 'Bear', pet: 'Boop', emoji: '🐻', blurb: 'gentle giant' },
  { id: 'PHOENIX', name: 'Phoenix', pet: 'Sol', emoji: '🐦‍🔥', blurb: 'radiant and warm' },
];
const AVATARS = ['🧒', '👧', '👦', '🦸‍♀️', '🦸‍♂️', '🧙‍♂️', '🥷', '👸', '🤴', '🧑‍🎤'];
function speciesOf(id) { return SPECIES.find(function (s) { return s.id === id; }) || SPECIES[0]; }
function stageArt(species, level) {
  const base = 'guardian-' + species.toLowerCase();
  if (level >= 25) return [base + '-3.jpg', base + '-2.jpg', base + '.jpg'];
  if (level >= 10) return [base + '-2.jpg', base + '.jpg'];
  return [base + '.jpg'];
}

// Frame files for a named motion, e.g. guardian-dragon-walk1.png ... -walk4.png.
// Probed in order; the static portrait is always the final fallback inside AnimArt.
function frameSet(species, motion, count) {
  const base = 'guardian-' + species.toLowerCase() + '-' + motion;
  const out = [];
  for (let i = 1; i <= count; i++) out.push(base + i + '.png');
  return out;
}

// AnimArt: if frame files exist it flips them as a loop; the moment a frame 404s
// (i.e. the family hasn't generated that motion yet) it falls back to the static
// portrait + CSS motion. Zero-config: every species works with or without frames.
function AnimArt(props) {
  // props.frames is the MAX candidate list (e.g. up to 4). We probe each in order and
  // animate however many actually exist: 0 -> static fallback, 1 -> static, 2+ -> smooth cycle.
  const candidates = props.frames || [];
  const [okFrames, setOkFrames] = useState(null); // null = probing, [] = none, [...] = the real ones
  const [frame, setFrame] = useState(0);
  const probedFor = useRef('');
  const key = candidates.join('|');
  useEffect(function () {
    if (candidates.length === 0) { setOkFrames([]); return; }
    if (probedFor.current === key) return;
    probedFor.current = key;
    setOkFrames(null);
    setFrame(0);
    let alive = true;
    // Probe sequentially: a frame only counts if it AND all earlier frames loaded,
    // so we never animate with a gap (e.g. frame1+frame3 but missing frame2).
    const results = new Array(candidates.length).fill(null);
    let done = 0;
    candidates.forEach(function (f, i) {
      const im = new Image();
      im.onload = function () { results[i] = true; finish(); };
      im.onerror = function () { results[i] = false; finish(); };
      im.src = './' + f;
    });
    function finish() {
      done += 1;
      if (done < candidates.length || !alive) return;
      const good = [];
      for (let i = 0; i < results.length; i++) {
        if (results[i]) good.push(candidates[i]); else break;
      }
      setOkFrames(good);
    }
    return function () { alive = false; };
  }, [key]);
  useEffect(function () {
    if (!okFrames || okFrames.length < 2) return;
    var reduce = false;
    try {
      reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        && !document.body.classList.contains('motion-force');
    } catch (e) {}
    if (reduce) { setFrame(0); return; }
    const hold = Math.max(160, Math.round(1000 / (props.fps || 4)));
    const id = setInterval(function () {
      setFrame(function (f) { return (f + 1) % okFrames.length; });
    }, hold);
    return function () { clearInterval(id); };
  }, [okFrames, key]);
  if (okFrames && okFrames.length >= 1) {
    const fade = (props.fade != null) ? props.fade : 420;
    return (
      <div className="anim-stack" aria-label={props.alt || ''}>
        {okFrames.map(function (f, i) {
          return (
            <img key={f} src={'./' + f} alt=""
              className="anim-frame"
              style={{ opacity: i === frame ? 1 : 0, transition: 'opacity ' + fade + 'ms ease-in-out' }} />
          );
        })}
      </div>
    );
  }
  // still probing OR none found -> the proven static portrait + CSS motion fallback
  return <Art srcs={props.fallback} emoji={props.emoji} alt={props.alt} />;
}

// Picks the right motion for the guardian's current situation.
function guardianMotion(species, level, mood) {
  // Prefer a CUT-OUT (transparent png) resting frame over the square jpg portrait, so the
  // guardian sits cleanly on the background instead of in an ugly opaque box. The square
  // jpg from stageArt() stays as the final fallback for species without cut-out frames.
  const cutoutRest = 'guardian-' + species.toLowerCase() + '-cheer2.png';
  const cheerPose = 'guardian-' + species.toLowerCase() + '-cheer1.png';
  const base = [cutoutRest].concat(stageArt(species, level));
  // NOTE: the four cheerN.png are DISTINCT illustrations (arms-up, resting, fire-breath, …),
  // not in-between animation cels. Cross-fading them as a loop ghosts two different poses on
  // top of each other. So idle/celebrate each hold ONE clean pose and lean on CSS for life;
  // only walk/sleep (which DO ship matched cycle frames) animate frame-to-frame.
  if (mood === 'walk') return { frames: frameSet(species, 'walk', 4), fallback: base, fps: 6, fade: 140, cls: 'm-walk' };
  if (mood === 'celebrate') return { frames: [cheerPose], fallback: base, fps: 1, fade: 0, cls: 'm-cheer' };
  if (mood === 'sleep') return { frames: frameSet(species, 'sleep', 3), fallback: base, fps: 1.6, fade: 700, cls: 'm-sleep' };
  if (mood === 'play') return { frames: [cheerPose], fallback: base, fps: 1, fade: 0, cls: 'm-play' };
  // idle: a single calm resting pose with a gentle CSS "breathe" — no cross-fade, no ghosting.
  return { frames: [cutoutRest], fallback: base, fps: 1, fade: 0, cls: 'm-breathe' };
}
const RARITY_COLOR = {
  COMMON: 'var(--r-common)', UNCOMMON: 'var(--r-uncommon)', RARE: 'var(--r-rare)',
  EPIC: 'var(--r-epic)', LEGENDARY: 'var(--r-legendary)', MYTHIC: 'var(--r-mythic)',
};
// big friendly treasure emoji for every item — a 5-year-old reads pictures, not names
const ITEM_EMOJI = {
  itm_wood: '🪵', itm_stone: '🪨', itm_fiber: '🌾', itm_clay: '🧱', itm_iron: '⛓️',
  itm_herbs: '🌿', itm_crystal: '🔮', itm_moonpetal: '🌸', itm_starsteel: '⚙️',
  itm_phoenix_feather: '🪶', itm_aether_shard: '💠', itm_loot_crate: '🎁',
  itm_berry: '🫐', itm_apple: '🍎', itm_honey: '🍯', itm_royal_stew: '🍲',
  itm_wood_sword: '🗡️', itm_leather_cap: '🧢', itm_iron_shield: '🛡️', itm_scout_boots: '🥾',
  itm_runed_blade: '⚔️', itm_guardian_plate: '🦺', itm_dawn_crown: '👑',
  itm_red_scarf: '🧣', itm_party_hat: '🎉', itm_star_cape: '⭐', itm_mythic_aura: '✨',
};
function itemEmoji(id) { return ITEM_EMOJI[id] || '💎'; }
const RARITY_LABEL = {
  COMMON: 'Common', UNCOMMON: 'Nice!', RARE: 'Rare!', EPIC: 'Epic!!', LEGENDARY: 'Legendary!!!', MYTHIC: 'MYTHIC!!!',
};
const RARITY_RANK = { COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4, MYTHIC: 5 };
const CATEGORY = {
  HYDRATION: { label: 'Hydration', icon: '💧' },
  HEALTH: { label: 'Health', icon: '🛁' },
  LEARNING: { label: 'Learning', icon: '📚' },
  RESPONSIBILITY: { label: 'Responsibility', icon: '🧺' },
  KINDNESS: { label: 'Kindness', icon: '💛' },
  FITNESS: { label: 'Fitness', icon: '🏃' },
};

function deleteDb(name) {
  return new Promise(function (resolve) {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = req.onerror = req.onblocked = function () { resolve(); };
  });
}
async function makeTestEnv() {
  await deleteDb(G.CONFIG.DB.testName);
  const backend = G.createIdbBackend(G.CONFIG.DB.testName);
  const db = G.makeDB(backend);
  await db.open();
  const repos = G.makeRepositories(db);
  const services = G.makeServices(db, repos);
  return {
    db: db, repos: repos, services: services,
    reset: function () { return db.clearAllStores(); },
    close: function () { return db.close(); },
  };
}
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + ':' + String(s % 60).padStart(2, '0');
}

/* Art: tries each src in turn; if all fail, renders the emoji fallback. */
function Art(props) {
  const [idx, setIdx] = useState(0);
  useEffect(function () { setIdx(0); }, [props.srcs.join('|')]);
  if (idx >= props.srcs.length) {
    return <div className="fallback" aria-hidden="true">{props.emoji}</div>;
  }
  return (
    <img
      src={'./' + props.srcs[idx]}
      alt={props.alt || ''}
      onError={function () { setIdx(idx + 1); }}
    />
  );
}

const noopSubscribe = function () { return function () {}; };
const nullSnapshot = function () { return null; };

/* ================= DEVELOPER MENU (debug tool — removable before launch) =================
   Activation: tap the splash logo 5x within 3s. Reset uses the REAL save systems:
   the 'guardian_hearth' IndexedDB + the two tutorial localStorage flags. No fake state. */
const DEV_DB_NAME = 'guardian_hearth';
const DEV_LS_KEYS = ['goth.tutorial.sol.v1', 'goth.coach.firstmission.v1', 'goth.bondTaps.v1'];

function DevMenu(props) {
  // props: store, state, onClose
  var state = props.state;
  var store = props.store;
  var g = state && state.guardian;
  var _c = useState(null); var confirm = _c[0]; var setConfirm = _c[1];
  var _m = useState(''); var msg = _m[0]; var setMsg = _m[1];

  function flash(t) { setMsg(t); setTimeout(function () { setMsg(''); }, 2200); }

  // THE BIG ONE: wipe all progress -> fresh install -> reload into first-time experience.
  async function resetToNewPlayer() {
    var hadError = false;
    // 1) CLEAR all game data via the OPEN database. This is the reliable part — it works on a
    //    live connection (no blocked-delete problem) and is enough to make a brand-new player.
    try {
      if (props.storeCtx && props.storeCtx.current && props.storeCtx.current.db) {
        await props.storeCtx.current.db.clearAllStores();
      }
    } catch (e) { hadError = true; }
    // 2) remove ALL goth.* localStorage keys (tutorial flags, bond taps, AND every child's
    //    dress-up cosmetics) so nothing from the old player lingers.
    try {
      var toRemove = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf('goth.') === 0) toRemove.push(k);
      }
      toRemove.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    } catch (e) { hadError = true; }
    // 3) best-effort: also delete the whole DB so a fresh schema is rebuilt. We do NOT block
    //    the reload on this (it can be blocked by the open connection on some devices).
    try {
      indexedDB.deleteDatabase(DEV_DB_NAME);
    } catch (e) {}
    // 4) reload after a short beat so the clear above is flushed. Always reloads, even on error.
    flash(hadError ? 'Reset had a hiccup — reloading…' : 'Fresh start! Reloading…');
    setTimeout(function () { window.location.reload(); }, 400);
  }

  // Tutorial flag controls (only touch flags, nothing else)
  function replayTutorial() {
    DEV_LS_KEYS.forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
    window.location.reload();
  }
  function skipTutorial() {
    DEV_LS_KEYS.forEach(function (k) { try { localStorage.setItem(k, '1'); } catch (e) {} });
    flash('Tutorial flags set to done.');
  }

  // Raid tools — use the REAL actions/services (no mechanic changes)
  async function finishActiveRaid() {
    try {
      var run = S.selectActiveRun(state);
      if (!run) { flash('No active raid.'); return; }
      // fast-forward this run's end time in the DB, then refresh
      await props.storeCtx.current.repos.dungeons.devSetEndsAt(run.id, Date.now() - 1000);
      await store.dispatch(A.refreshChild());
      flash('Active raid is now ready to claim!');
    } catch (e) { flash('Could not finish raid: ' + (e && e.message)); }
  }
  async function startTestRaid() {
    try {
      var view = S.selectDungeonView(state);
      var avail = view.find(function (d) { return !d.isActive && d.unlocked && !d.blocked; });
      if (!avail) { flash('No raid available to start.'); return; }
      var r = await store.dispatch(A.startDungeon(avail.def.id));
      flash(r && r.ok ? ('Started: ' + avail.def.name) : 'Could not start (energy?).');
    } catch (e) { flash('Error: ' + (e && e.message)); }
  }

  // Reward tools — use the REAL bundle pipeline (no fake currencies)
  async function grant(kind) {
    try {
      var id = state.activeChildId;
      if (!id) { flash('No active child.'); return; }
      var bundle = { coins: 0, energy: 0, xp: 0, affection: 0, materials: [], lootCrates: 0 };
      if (kind === 'xp') bundle.xp = 100;
      if (kind === 'coins') bundle.coins = 500;
      if (kind === 'loot') bundle.lootCrates = 1;
      await props.storeCtx.current.repos.guardians.applyBundle(id, bundle);
      await store.dispatch(A.refreshChild());
      flash('Granted ' + (kind === 'xp' ? '+100 XP' : kind === 'coins' ? '+500 gold' : '1 loot crate') + '.');
    } catch (e) { flash('Grant failed: ' + (e && e.message)); }
  }

  var pendingCount = state && state.pending ? state.pending.length : 0;
  var activeRun = S.selectActiveRun(state);

  return (
    <div className="dev-overlay" onClick={props.onClose}>
      <div className="dev-panel" onClick={function (e) { e.stopPropagation(); }}>
        <div className="dev-head">
          <span>🛠 Developer Mode</span>
          <button className="dev-x" onClick={props.onClose}>✕</button>
        </div>
        {msg && <div className="dev-msg">{msg}</div>}

        <div className="dev-section">
          <div className="dev-s-title">⚠️ Reset</div>
          {confirm === 'reset' ? (
            <div className="dev-confirm">
              <div>This will erase ALL progress and restart from the beginning.</div>
              <div className="dev-confirm-btns">
                <button className="dev-btn danger" onClick={resetToNewPlayer}>Yes, erase everything</button>
                <button className="dev-btn" onClick={function () { setConfirm(null); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="dev-btn danger" onClick={function () { setConfirm('reset'); }}>🔄 Reset to New Player</button>
          )}
        </div>

        <div className="dev-section">
          <div className="dev-s-title">Tutorial</div>
          <div className="dev-row">
            <button className="dev-btn" onClick={replayTutorial}>▶️ Replay</button>
            <button className="dev-btn" onClick={skipTutorial}>⏭ Skip</button>
          </div>
        </div>

        <div className="dev-section">
          <div className="dev-s-title">Raids</div>
          <div className="dev-row">
            <button className="dev-btn" onClick={finishActiveRaid}>⚡ Finish active</button>
            <button className="dev-btn" onClick={startTestRaid}>🗺 Start test</button>
          </div>
        </div>

        <div className="dev-section">
          <div className="dev-s-title">Rewards</div>
          <div className="dev-row">
            <button className="dev-btn" onClick={function () { grant('xp'); }}>+100 XP</button>
            <button className="dev-btn" onClick={function () { grant('coins'); }}>+500 Gold</button>
            <button className="dev-btn" onClick={function () { grant('loot'); }}>+ Loot crate</button>
          </div>
        </div>

        <div className="dev-section">
          <div className="dev-s-title">Save Info</div>
          <div className="dev-info">
            <div>Guardian: {g ? g.name : '—'} · Lv {g ? g.level : '—'}</div>
            <div>XP: {g ? g.xp : '—'} · Energy: {g ? g.energy : '—'}/{g ? g.maxEnergy : '—'}</div>
            <div>Gold: {g ? g.gold : '—'} · Affection: {g ? g.affection : '—'}</div>
            <div>Pending quests: {pendingCount}</div>
            <div>Active raid: {activeRun ? 'yes' : 'no'}</div>
            <div>Tutorial done: {(function () { try { return localStorage.getItem('goth.tutorial.sol.v1') === '1' ? 'yes' : 'no'; } catch (e) { return '?'; } })()}</div>
            <div>Save: IndexedDB “guardian_hearth” v1</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [store, setStore] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [splashDone, setSplashDone] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  const devTaps = useRef([]);
  function devLogoTap() {
    var now = Date.now();
    devTaps.current = devTaps.current.filter(function (t) { return now - t < 3000; });
    devTaps.current.push(now);
    if (devTaps.current.length >= 5) { devTaps.current = []; Sfx.achieve && Sfx.achieve(); setDevOpen(true); }
  }
  const [tab, setTab] = useState('home');
  const [showSwitcher, setShowSwitcher] = useState(false);
  const [showOnboard, setShowOnboard] = useState(false);
  const [solIntro, setSolIntro] = useState(false);
  const storeCtx = useRef(null);
  const state = useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getState : nullSnapshot
  );

  useEffect(function () {
    if (!window.indexedDB) { setFatal('This device blocks app storage, so the hearth cannot keep its memory. Try Safari or Chrome.'); return; }
    (async function () {
      try {
        const backend = G.createIdbBackend(G.CONFIG.DB.name);
        const db = G.makeDB(backend);
        await db.open();
        const repos = G.makeRepositories(db);
        const services = G.makeServices(db, repos, { now: gameNow });
        const ctx = { db: db, repos: repos, services: services, now: gameNow };
        storeCtx.current = ctx;
        const s = G.makeStore(ctx);
        setStore(s);
        await s.dispatch(A.boot());
      } catch (e) { setFatal((e && e.message) || String(e)); }
    })();
    const t = setTimeout(function () { setSplashDone(true); }, 1400);
    return function () { clearTimeout(t); };
  }, []);

  useEffect(function () {
    if (!store || !state || state.boot !== 'READY') return;
    const id = setInterval(function () { store.dispatch(A.tick(gameNow())); }, 1000);
    return function () { clearInterval(id); };
  }, [store, state && state.boot]);

  /* toasts fade on their own */
  useEffect(function () {
    if (!store || !state || !state.ui.toast) return;
    const id = setTimeout(function () { store.dispatch(A.clearToast('main')); }, 3600);
    return function () { clearTimeout(id); };
  }, [store, state && state.ui.toast]);

  /* the hero evolves: when approved chores cross a Keeper milestone, celebrate */
  const prevKeeper = useRef(null);
  useEffect(function () {
    if (!store || !state || state.boot !== 'READY') return;
    const child = S.selectActiveChild(state);
    if (!child) { prevKeeper.current = null; return; }
    const k = S.selectKeeper(state);
    const prev = prevKeeper.current;
    prevKeeper.current = { id: child.id, stage: k.stage };
    if (prev && prev.id === child.id && k.stage > prev.stage) {
      store.dispatch({ type: G.ActionTypes.CELEBRATION_SHOW,
        celebration: { type: 'keeper', name: k.name, title: k.title, emoji: k.emoji, aura: k.aura, art: k.art } });
      Sfx.achieve && Sfx.achieve();
    }
  }, [store, state && state.approvals, state && state.activeChildId, state && state.boot]);

  /* sound: unlock on first touch (iOS rule) + soft tap on every button */
  useEffect(function () {
    function onDown(e) {
      Sfx.unlock();
      if (e.target && e.target.closest && e.target.closest('button')) Sfx.tap();
    }
    document.addEventListener('pointerdown', onDown);
    return function () { document.removeEventListener('pointerdown', onDown); };
  }, []);

  /* sound preference persists per device */
  useEffect(function () {
    if (!state || state.boot !== 'READY' || !storeCtx.current) return;
    storeCtx.current.repos.meta.get('pref.sound').then(function (v) {
      if (v === false) Sfx.setOn(false);
    });
    storeCtx.current.repos.meta.get('pref.motion').then(function (v) {
      applyMotionPref(v || 'auto');
    });
  }, [state && state.boot]);

  /* celebrations and errors get their voices */
  useEffect(function () {
    const c = state && state.ui.celebration;
    if (!c) return;
    if (c.type === 'levelUp') Sfx.levelUp();
    else if (c.type === 'achievement') Sfx.achieve();
    else if (c.type === 'flame') Sfx.flame();
    else Sfx.chest();
  }, [state && state.ui.celebration]);
  useEffect(function () {
    const t = state && state.ui.toast;
    if (t && t.kind === 'bad') Sfx.error();
  }, [state && state.ui.toast]);
  useEffect(function () {
    function vis() { Music.sync(); }
    document.addEventListener('visibilitychange', vis);
    return function () { document.removeEventListener('visibilitychange', vis); };
  }, []);

  const booting = !state || state.boot === 'LOADING' || !splashDone;
  const children = state ? S.selectChildren(state) : [];

  // First-time magic: if there are no keepers yet and Sol hasn't welcomed them, play the cinematic.
  useEffect(function () {
    if (state && state.boot === 'READY' && children.length === 0 && !solTutorialDone()) {
      setSolIntro(true);
    }
  }, [state && state.boot, children.length]);

  return (
    <React.Fragment>
      {devOpen && <DevMenu store={store} state={state} storeCtx={storeCtx} onClose={function () { setDevOpen(false); }} />}
      {solIntro && <SolWelcome onDone={function () { setSolIntro(false); }} />}
      {state && state.boot === 'READY' && state.mode === 'PARENT_MODE' && state.session ? (
        <ParentShell store={store} state={state} storeCtx={storeCtx} />
      ) : state && state.boot === 'READY' ? (
        children.length === 0 || showOnboard ? (
          <Onboarding
            store={store} state={state}
            canCancel={children.length > 0}
            onDone={function () { setShowOnboard(false); setTab('home'); }}
          />
        ) : (
          <ChildShell
            store={store} state={state} tab={tab} setTab={setTab} storeCtx={storeCtx}
            openSwitcher={function () { setShowSwitcher(true); }}
            onDevTap={devLogoTap}
          />
        )
      ) : null}

      {state && state.boot === 'ERROR' && (
        <div className="shell"><div className="card" style={{ marginTop: 60 }}>
          <h2>The hearth didn't light</h2>
          <p className="note">{state.bootInfo.error}</p>
        </div></div>
      )}
      {fatal && (
        <div className="shell"><div className="card" style={{ marginTop: 60 }}>
          <h2>The hearth didn't light</h2>
          <p className="note">{fatal}</p>
        </div></div>
      )}

      {showSwitcher && state && (
        <div className="veil" onClick={function () { setShowSwitcher(false); }}>
          <div className="sheet" onClick={function (e) { e.stopPropagation(); }}>
            <h2 style={{ marginBottom: 12 }}>Who's playing?</h2>
            {children.map(function (c) {
              return (
                <button key={c.id} className="btn" style={{ width: '100%', marginBottom: 8, justifyContent: 'flex-start' }}
                  onClick={function () { store.dispatch(A.selectChild(c.id)); setShowSwitcher(false); setTab('home'); }}>
                  <span style={{ fontSize: 22 }}>{c.avatar}</span> {c.name}
                  {c.id === state.activeChildId && <span className="seal" style={{ marginLeft: 'auto' }}>playing</span>}
                </button>
              );
            })}
            <button className="btn primary" style={{ width: '100%' }}
              onClick={function () { setShowSwitcher(false); setShowOnboard(true); }}>
              + New child
            </button>
          </div>
        </div>
      )}

      {!fatal && (
        <div className={'splash' + (booting ? '' : ' bye')} aria-hidden={!booting}>
          <div onClick={devLogoTap} style={{ cursor: 'default' }}>
            <Art srcs={['logo.jpg']} emoji="🛡️" alt="Guardian of the Hearth" />
          </div>
          <div>
            <div className="eyebrow" style={{ textAlign: 'center', marginBottom: 6 }}>A family quest game</div>
            <div className="display">Guardian of the Hearth</div>
          </div>
          <span className="ember" />
        </div>
      )}
    </React.Fragment>
  );
}

/* ---------------- Sol's cinematic welcome (first-time, voice-guided) ---------------- */
const APP_VERSION = 'W5.6'; // bump every ship — shown in the corner so you can confirm the update loaded
const SOL_WELCOME_KEY = 'goth.tutorial.sol.v1';
function solTutorialDone() { try { return localStorage.getItem(SOL_WELCOME_KEY) === '1'; } catch (e) { return false; } }
function markSolTutorialDone() { try { localStorage.setItem(SOL_WELCOME_KEY, '1'); } catch (e) {} }

function SolWelcome(props) {
  // a sequence of "beats" — Sol speaks each, child taps the glowing button to continue.
  const BEATS = [
    { text: 'Welcome, little Guardian! To create your hero and choose your magical friend, please hand the game to a grown-up to help you!', btn: 'Okay! \uD83C\uDF1F' },
  ];
  const [beat, setBeat] = useState(0);
  const [shown, setShown] = useState(0);
  const cur = BEATS[beat];

  // speak each beat as it appears; typewriter the words for kids who can read a little
  useEffect(function () {
    setShown(0);
    Voice.speak(cur.text);
    const id = setInterval(function () {
      setShown(function (s) { if (s >= cur.text.length) { clearInterval(id); return s; } return s + 1; });
    }, 38);
    return function () { clearInterval(id); };
  }, [beat]);

  function next() {
    Voice.stop();
    if (beat < BEATS.length - 1) setBeat(beat + 1);
    else { markSolTutorialDone(); props.onDone(); }
  }

  return (
    <div className="sol-cine" onClick={function () { /* tap text area reveals full line */ if (shown < cur.text.length) setShown(cur.text.length); }}>
      <div className="sol-stars">
        {Array.from({ length: 18 }).map(function (_, i) {
          return <span key={i} className="sol-star" style={{ left: (7 + (i * 37) % 92) + '%', top: (8 + (i * 53) % 78) + '%', animationDelay: (i * 0.21) + 's' }} />;
        })}
      </div>
      <div className="sol-stage">
        <div className="sol-halo" />
        <div className="sol-dragon">🐉</div>
        <div className="sol-flame">🔥</div>
      </div>
      <div className="sol-namecard">Sol · Guardian of the Hearth</div>
      <div className="sol-speech">{cur.text.slice(0, shown)}<span className="sol-caret">|</span></div>
      <button className="sol-cta" onClick={function (e) { e.stopPropagation(); next(); }}>{cur.btn}</button>
      <button className="sol-skip" onClick={function (e) { e.stopPropagation(); Voice.stop(); markSolTutorialDone(); props.onDone(); }}>Skip</button>
    </div>
  );
}

/* ---------------- onboarding ---------------- */
function Onboarding(props) {
  const kids = S.selectChildren(props.state);
  const [name, setName] = useState('');
  const [species, setSpecies] = useState('FOX');
  const [petName, setPetName] = useState('Pip');
  const [avatar, setAvatar] = useState('🧒');
  const [busy, setBusy] = useState(false);
  function pick(id) { setSpecies(id); setPetName(speciesOf(id).pet); }
  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    const r = await props.store.dispatch(A.createChild(name.trim(), avatar, petName.trim() || speciesOf(species).pet, species));
    setBusy(false);
    if (r.ok) {
      // STEP 3: emotional first meeting — the guardian and child are now friends.
      try { Voice.speak('You and your ' + (petName.trim() || speciesOf(species).pet) + ' are now friends! Let\'s go play together!'); } catch (e) {}
      props.onDone();
    }
  }
  return (
    <React.Fragment>
      <div className="screen-bg home" />
      <div className="shell">
        <div className="shell-main" style={{ paddingTop: 8 }}>
          <div className="eyebrow" style={{ marginBottom: 4 }}>{kids.length === 0 ? 'Welcome to the hearth' : 'A new keeper joins'}</div>
          <h1 style={{ fontSize: 26, marginBottom: 14 }}>Choose your guardian</h1>
          <div className="card">
            <input className="field" value={name} maxLength={20} placeholder="Child's name"
              onChange={function (e) { setName(e.target.value); }} />
            <div className="eyebrow" style={{ margin: '8px 0 0' }}>Your hero</div>
            <div className="av-grid">
              {AVATARS.map(function (a) {
                return (
                  <button key={a} className={'av-cell' + (avatar === a ? ' on' : '')}
                    onClick={function () { setAvatar(a); }}>{a}</button>
                );
              })}
            </div>
            <div className="eyebrow" style={{ margin: '10px 0 0' }}>Your guardian</div>
            <div className="species-grid">
              {SPECIES.map(function (sp) {
                return (
                  <button key={sp.id} className={'sp-cell' + (species === sp.id ? ' on' : '')}
                    onClick={function () { pick(sp.id); }}>
                    <Art srcs={['guardian-' + sp.id.toLowerCase() + '.jpg']} emoji={sp.emoji} alt={sp.name} />
                    <span className="sp-name">{sp.name}</span>
                  </button>
                );
              })}
            </div>
            <p className="note" style={{ marginTop: 0 }}>The {speciesOf(species).name.toLowerCase()} is {speciesOf(species).blurb}.</p>
            <input className="field" value={petName} maxLength={16} placeholder="Guardian's name"
              onChange={function (e) { setPetName(e.target.value); }} />
            <div className="btnrow" style={{ marginTop: 6 }}>
              {props.canCancel && <button className="btn" onClick={props.onDone}>Cancel</button>}
              <button className="btn primary" disabled={!name.trim() || busy} onClick={create}>
                {busy ? 'Lighting the hearth…' : 'Begin the watch'}
              </button>
            </div>
          </div>
          <p className="note">Complete Guardian Missions in the real world to help your guardian grow stronger! A grown-up cheers on every one.</p>
        </div>
      </div>
    </React.Fragment>
  );
}

/* ---------------- child shell ---------------- */
function VoicePicker(props) {
  const [voices, setVoices] = useState([]);
  useEffect(function () {
    function compute() {
      Voice.refresh();
      const en = Voice.list.filter(function (v) { return Voice.score(v) >= 0; });
      en.sort(function (a, b) { return Voice.score(b) - Voice.score(a); });
      setVoices(en.slice(0, 8));
    }
    compute();
    try { window.speechSynthesis.addEventListener('voiceschanged', compute); } catch (e) {}
    return function () {
      try { window.speechSynthesis.removeEventListener('voiceschanged', compute); } catch (e) {}
    };
  }, []);
  return (
    <div className="veil" onClick={props.onClose}>
      <div className="sheet" onClick={function (e) { e.stopPropagation(); }}>
        <div className="eyebrow">Pick a voice</div>
        <p className="note" style={{ marginTop: 4 }}>Tap one to hear it. {props.childName} keeps this voice.</p>
        <ul className="vlist">
          {voices.map(function (v) {
            const pretty = v.name.replace(/\s*\((Enhanced|Premium)\)\s*/i, '');
            const fancy = /premium|enhanced/i.test(v.name);
            const cur = v.name === props.current || (!props.current && voices[0] && v.name === voices[0].name);
            return (
              <li key={v.name} className={cur ? 'cur' : ''} onClick={function () { props.onPick(v.name); }}>
                <span style={{ flex: 1 }}>{pretty}{fancy ? ' \u2728' : ''}</span>
                {cur ? <span style={{ color: 'var(--gold)' }}>\u2713</span> : null}
              </li>
            );
          })}
          {voices.length === 0 && <li className="cur">Loading device voices\u2026</li>}
        </ul>
        <button className="btn" style={{ width: '100%', marginTop: 10 }} onClick={props.onOff}>
          \uD83D\uDD07 Turn read-aloud off
        </button>
        <button className="btn primary" style={{ width: '100%', marginTop: 8 }} onClick={props.onClose}>Done</button>
      </div>
    </div>
  );
}

function ChildShell(props) {
  const state = props.state;
  const store = props.store;
  // LIVE GUIDANCE: what should glow right now for a brand-new player (null once they've acted)
  const guide = priorityGlow(state, props.tab); // single source: only ONE thing glows, by priority

  // W2.5 IDLE NUDGE: if the child pauses during guidance, gently wiggle the glowing target.
  // Repeats every few seconds while idle so a distracted child is re-invited to tap.
  useEffect(function () {
    if (!guide) return; // only while actively guiding
    var timer = null;
    function wiggle() {
      var el = document.querySelector('.guide-glow');
      if (el) {
        el.classList.add('idle-nudge');
        setTimeout(function () { if (el) el.classList.remove('idle-nudge'); }, 1300);
      }
      arm(); // keep gently nudging until the child acts
    }
    function arm() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(wiggle, 4500); // ~4.5s of stillness -> a gentle nudge, then again
    }
    function onAny() { arm(); } // any interaction resets the idle timer
    arm();
    document.addEventListener('pointerdown', onAny, true);
    document.addEventListener('keydown', onAny, true);
    return function () {
      if (timer) clearTimeout(timer);
      document.removeEventListener('pointerdown', onAny, true);
      document.removeEventListener('keydown', onAny, true);
      var el = document.querySelector('.guide-glow.idle-nudge');
      if (el) el.classList.remove('idle-nudge');
    };
  }, [guide, props.tab]);
  // once the child has engaged (guidance resolves to null because they submitted a quest),
  // permanently mark guidance done so the glow never returns.
  useEffect(function () {
    try {
      if (!coachDone() && solTutorialDone()) {
        const submitted = (state.pending && state.pending.length > 0);
        const anyDone = state.questBoard && state.questBoard.some(function (b) { return b.remainingToday < b.quest.maxPerDay; });
        if (submitted || anyDone) markCoachDone();
      }
    } catch (e) {}
  }, [state.pending && state.pending.length]);
  const [holding, setHolding] = useState(false);
  const pressTimer = useRef(null);
  const [soundOn, setSoundOn] = useState(Sfx.isOn());
  const [voiceOn, setVoiceOn] = useState(Voice.on);
  const [voiceChoice, setVoiceChoice] = useState(Voice.chosen);
  const [showVoices, setShowVoices] = useState(false);
  useEffect(function () { setSoundOn(Sfx.isOn()); }, [state.now]);
  useEffect(function () { Music.setScene(props.tab === 'raids' ? 'raids' : 'hearth'); }, [props.tab]);
  useEffect(function () {
    const id = state.activeChildId;
    if (!id || !props.storeCtx || !props.storeCtx.current) return;
    props.storeCtx.current.repos.meta.get('pref.voice.' + id).then(function (v) {
      Voice.on = v === 'on';
      setVoiceOn(Voice.on);
    });
    props.storeCtx.current.repos.meta.get('pref.voiceName.' + id).then(function (v) {
      Voice.chosen = v || '';
      setVoiceChoice(Voice.chosen);
    });
  }, [state.activeChildId]);
  function toggleSound() {
    const v = !soundOn;
    setSoundOn(v);
    Sfx.setOn(v);
    if (v) Sfx.tap();
    if (props.storeCtx && props.storeCtx.current) {
      props.storeCtx.current.repos.meta.set('pref.sound', v);
    }
  }
  function setVoicePref(on) {
    const id = state.activeChildId;
    if (id && props.storeCtx && props.storeCtx.current) {
      props.storeCtx.current.repos.meta.set('pref.voice.' + id, on ? 'on' : 'off');
    }
  }
  function toggleVoice() {
    if (!voiceOn) {
      Voice.on = true;
      setVoiceOn(true);
      setVoicePref(true);
      Voice.say('Voice is on! Tap a quest and I will read it to you.');
    } else {
      setShowVoices(true);
    }
  }
  function voiceOff() {
    Voice.on = false;
    setVoiceOn(false);
    setShowVoices(false);
    Voice.stop();
    setVoicePref(false);
  }
  function pickVoice(name) {
    Voice.chosen = name;
    setVoiceChoice(name);
    const id = state.activeChildId;
    if (id && props.storeCtx && props.storeCtx.current) {
      props.storeCtx.current.repos.meta.set('pref.voiceName.' + id, name);
    }
    Voice.say('Hi ' + (child ? child.name : 'friend') + '! I will read your quests!');
  }
  const child = S.selectActiveChild(state);
  const pendingCount = state.pending.length;

  function pressStart() {
    setHolding(true);
    pressTimer.current = setTimeout(function () {
      setHolding(false);
      store.dispatch(A.revealGate());
    }, 3000);
  }
  function pressEnd() {
    setHolding(false);
    if (pressTimer.current) { clearTimeout(pressTimer.current); pressTimer.current = null; }
  }

  const TABS = [
    { id: 'home', ti: '🔥', label: 'Hearth' },
    { id: 'quests', ti: '⭐', label: 'Missions' },
    { id: 'raids', ti: '🗺️', label: 'Raids' },
    { id: 'island', ti: '🏝️', label: 'Island' },
    { id: 'bag', ti: '🎒', label: 'Bag' },
  ];

  return (
    <React.Fragment>
      <div className="ver-badge" aria-hidden="true">{APP_VERSION}</div>
      <div className={'screen-bg ' + (props.tab === 'raids' ? 'raids' : 'home')} />
      <div className="flicker" aria-hidden="true" />
      <div className="sparks" aria-hidden="true">{SPARKS}</div>
      <div className={'shell' + (guide ? ' focus-mode' : '')}>
        <header className="hdr">
          <div className="hdr-title"
            onPointerDown={pressStart} onPointerUp={pressEnd}
            onPointerLeave={pressEnd} onPointerCancel={pressEnd}
            onClick={function () { if (props.onDevTap) props.onDevTap(); }}
            onContextMenu={function (e) { e.preventDefault(); }}>
            <span className={'ember' + (holding ? ' holding' : '')} aria-hidden="true" />
            Guardian of the Hearth
          </div>
          <span style={{ display: 'flex', gap: 8 }}>
            <button className="hdr-kid snd" onClick={toggleSound}
              aria-label={soundOn ? 'Mute sounds' : 'Unmute sounds'}>
              {soundOn ? '🔊' : '🔇'}
            </button>
            <button className="hdr-kid snd" onClick={toggleVoice}
              aria-label={voiceOn ? 'Voice options' : 'Turn read-aloud on'}>
              {voiceOn ? '🗣️' : '💬'}
            </button>
            {showVoices && (
              <VoicePicker childName={child ? child.name : ''} current={voiceChoice}
                onPick={pickVoice} onOff={voiceOff}
                onClose={function () { setShowVoices(false); }} />
            )}
            {child && (
              <button className="hdr-kid" onClick={props.openSwitcher}>
                <span>{child.avatar}</span> {child.name}
              </button>
            )}
          </span>
        </header>
        <main className="shell-main" key={props.tab + (state.activeChildId || '')}>
          {props.tab === 'home' && <HomeScreen store={store} state={state} setTab={props.setTab} guide={guide} />}
          {props.tab === 'quests' && <QuestsScreen store={store} state={state} guide={guide} />}
          {props.tab === 'raids' && <RaidsScreen store={store} state={state} guide={guide} />}
          {props.tab === 'island' && <IslandScreen store={store} state={state} setTab={props.setTab} />}
          {props.tab === 'bag' && <BagScreen store={store} state={state} guide={guide} />}
        </main>
      </div>
      <nav className="tabbar">
        {TABS.map(function (t) {
          return (
            <button key={t.id} className={'tab' + (props.tab === t.id ? ' on' : '') + (((guide === 'quests-tab' && t.id === 'quests') || (guide === 'home-tab' && t.id === 'home') || (guide === 'raids-tab' && t.id === 'raids') || (guide === 'bag-tab' && t.id === 'bag')) ? ' guide-glow' : '')}
              onClick={function () { props.setTab(t.id); }}>
              <span className="ti">{t.ti}</span>{t.label}
              {t.id === 'quests' && pendingCount > 0 && <span className="dot">{pendingCount}</span>}
            </button>
          );
        })}
      </nav>
      {state.ui.gateRevealed && !state.session && <GateModal store={store} state={state} />}
      {state.ui.celebration && <Celebration store={store} state={state} />}
      {state.ui.toast && <div className={'toast ' + (state.ui.toast.kind === 'ok' ? 'ok' : 'bad')}>{state.ui.toast.text}</div>}
    </React.Fragment>
  );
}

/* ---------------- first-mission guided coach (voice + highlight) ---------------- */
const COACH_KEY = 'goth.coach.firstmission.v1';
function coachDone() { try { return localStorage.getItem(COACH_KEY) === '1'; } catch (e) { return false; } }
function markCoachDone() { try { localStorage.setItem(COACH_KEY, '1'); } catch (e) {} }

// ---- LIVE GUIDANCE (plan B): glow the next thing to tap, inside the real game ----
// Returns what to highlight RIGHT NOW for a brand-new player, or null once they've engaged.
// A kid follows a glowing button instinctively — no overlay, no reading required.
// PLAY-FIRST bonding gate: a non-reader should bond with the guardian BEFORE any mission
// is suggested. We count guardian taps; until they've played a few times, guidance points
// at the GUARDIAN (not missions). Only after bonding does the mission-glow appear.
const BOND_TAPS_KEY = 'goth.bondTaps.v1';
const BOND_TAPS_NEEDED = 3;
function getBondTaps() { try { return parseInt(localStorage.getItem(BOND_TAPS_KEY) || '0', 10) || 0; } catch (e) { return 0; } }
function addBondTap() { try { localStorage.setItem(BOND_TAPS_KEY, String(getBondTaps() + 1)); } catch (e) {} }

// ===== W3.3 SINGLE PRIORITY RESOLVER =====
// The ONE brain that decides what (if anything) should glow right now. Returns a single
// target so only ONE thing is ever highlighted. Strict priority order (spec):
//   1) Raid ready to claim  2) Crate ready to open  3) Mission flow (onboarding)  4) bond/play
// LEVEL 1 things (guardian, voice button) are always soft and never returned here.
function priorityGlow(state, tab) {
  if (!state) return null;
  // === FIRST-TIME PLAYER OVERRIDE ===
  // A brand-new child must bond with their guardian FIRST. While onboarding guidance is
  // active, it OVERRIDES the normal raid/crate priority — so the satchel never glows before
  // the child has met and played with their guardian. (Starter grant gives crates, which
  // previously lit the satchel on the very first screen — exactly the bug to prevent.)
  var onboarding = guideStep(state, tab);
  if (onboarding) return onboarding;
  // === NORMAL GAMEPLAY PRIORITY (only once the child has bonded + done a first mission) ===
  // --- A raid that has RETURNED and is waiting to be claimed (the child sent it; time-sensitive) ---
  try {
    var run = S.selectActiveRun(state);
    if (run && state.now >= run.endsAt) {
      return (tab === 'raids') ? 'raid-claim' : 'raids-tab';
    }
  } catch (e) {}
  // NOTE: crates intentionally do NOT force a glow. With 3 starter crates the satchel glow
  // became an inescapable loop (open one → still glowing → open another…) and it overrode the
  // "celebrate with your guardian" moment after a mission. Crates are a reward to DISCOVER in
  // the bag, not a chore the game pushes. The guardian + missions are the guided loop.
  return null;
}

// Onboarding mission guidance (play-first → mission → transition). Only fires for a brand-new
// hero; once they've engaged it returns null and the priority resolver falls through to nothing.
function guideStep(state, tab) {
  if (!state) return null;
  // "I DID IT" TRANSITION (checked BEFORE coachDone so it always runs after a mission):
  // bridge the child BACK to their guardian to celebrate together — never a dead-end.
  try {
    if (sessionStorage.getItem('goth.justDidMission.v1') === '1') {
      if (tab === 'home') { sessionStorage.removeItem('goth.justDidMission.v1'); return 'pet-guardian'; }
      return 'home-tab';
    }
  } catch (e) {}
  if (coachDone()) return null;
  const kids = (state.users || []).filter(function (u) { return u.role === 'CHILD'; });
  if (kids.length > 1) return null; // only guide the very first hero
  const submittedEver = (state.pending && state.pending.length > 0);
  const anyDone = state.questBoard && state.questBoard.some(function (b) { return b.remainingToday < b.quest.maxPerDay; });
  if (submittedEver || anyDone) return null;
  // PLAY FIRST: until bonded, guide to the guardian.
  if (getBondTaps() < BOND_TAPS_NEEDED) {
    return (tab === 'home') ? 'pet-guardian' : 'home-tab';
  }
  // bonded! introduce the first mission.
  if (tab !== 'quests') return 'quests-tab';
  return 'first-quest';
}

/* ---------------- the First Flame ---------------- */
function FlameOrb(props) {
  const [fail, setFail] = useState(false);
  const V = G.CONFIG.FLAME.VISUALS;
  const glow = V.SHRINE_GLOW[props.stage];
  if (!fail) {
    return (
      <img src={'./flame-stage' + props.stage + '.png'} alt=""
        style={{ width: 52, height: 52, objectFit: 'contain', filter: 'drop-shadow(0 0 ' + glow + 'px rgba(232,133,61,0.85))' }}
        onError={function () { setFail(true); }} />
    );
  }
  const px = V.SHRINE_PX[props.stage] + 16;
  return <span className="fl" style={{ width: px, height: px, boxShadow: '0 0 ' + glow + 'px ' + Math.round(glow / 2) + 'px rgba(232,133,61,0.7)' }} />;
}

// The child's own hero — evolves through stages as chores are approved.
function KeeperCard(props) {
  const state = props.state;
  const child = S.selectActiveChild(state);
  if (!child) return null;
  const k = S.selectKeeper(state);
  const emoji = k.emoji || child.avatar || '🧒';
  return (
    <div className="card keeper-card">
      <div className="keeper-crest">
        <div className="keeper-ring" style={{ boxShadow: '0 0 0 3px ' + k.aura + ', 0 0 22px ' + k.aura }}>
          <Art srcs={k.art ? [k.art] : []} emoji={emoji} alt={child.name} />
        </div>
        <div className="keeper-meta">
          <div className="keeper-name">{child.name} · <span className="display" style={{ color: k.aura }}>{k.name}</span></div>
          <div className="keeper-title">{k.title}</div>
          {!k.isMax
            ? <div className="keeper-next">{k.toNext} more {k.toNext === 1 ? 'chore' : 'chores'} → {k.nextName}</div>
            : <div className="keeper-next">The highest a Keeper can rise. ✨</div>}
        </div>
      </div>
      {!k.isMax && <div className="xp-bar keeper-bar"><span style={{ width: Math.round(k.progress * 100) + '%' }} /></div>}
    </div>
  );
}

function FlameCard(props) {
  const fd = S.selectFlame(props.state);
  const [whispers, setWhispers] = useState(false);
  return (
    <div className="card">
      <div className="flame-row">
        <span className="flame-orb"><FlameOrb stage={fd.stage} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="eyebrow">The First Flame</div>
          <div className="flame-stagename">{fd.name}</div>
          <div className="flame-bar"><span style={{ width: Math.round(fd.progress * 100) + '%' }} /></div>
          <div className="note" style={{ marginTop: 5 }}>
            {fd.nextAt !== null
              ? (fd.nextAt - fd.points) + ' sparks to ' + fd.nextName
              : 'The flame burns eternal.'}
          </div>
        </div>
        <span className="num" style={{ alignSelf: 'flex-start', fontSize: 13, color: 'var(--gold)' }}>{fd.points}</span>
      </div>
      <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>Kindness, gratitude, and family quests feed the flame.</p>
      {fd.memories.length > 0 && (
        <button className="btn" style={{ marginTop: 8, minHeight: 40, fontSize: 14 }}
          onClick={function () { setWhispers(true); }}>
          📜 Whispers of the First Flame ({fd.memories.length})
        </button>
      )}
      {whispers && (
        <div className="veil" onClick={function () { setWhispers(false); }}>
          <div className="sheet" onClick={function (e) { e.stopPropagation(); }}>
            <div className="eyebrow">Whispers of the First Flame</div>
            <ul className="wlist">
              {G.CONFIG.FLAME.MEMORIES.map(function (m, i) {
                const open = fd.points >= m.at;
                return (
                  <li key={i} className={open ? '' : 'locked'}
                    onClick={function () { if (open) playClip('./voice-whisper-' + (i + 1) + '.mp3', m.text); }}>
                    {open ? '\u201C' + m.text + '\u201D' : '\u2026 something stirs deeper in the flame'}
                  </li>
                );
              })}
            </ul>
            <button className="btn" style={{ width: '100%', marginTop: 10 }}
              onClick={function () { setWhispers(false); }}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- home ---------------- */
/* ============================ PRINCESS DRESS-UP ============================ */
// Owned/equipped cosmetics are stored per-child in localStorage (cosmetic-only,
// kept out of the validated game DB so there's zero economy/save risk).
function cosmKey(childId) { return 'goth.cosmetics.' + childId; }
function loadCosmetics(childId) {
  try {
    if (!childId || !window.GOTH || !GOTH.Cosmetics) {
      return { owned: {}, equipped: {} };
    }
    try {
      var raw = localStorage.getItem(cosmKey(childId));
      if (raw) return JSON.parse(raw);
    } catch (e) {}
    // first time: grant the free starter items + equip the starter look
    var owned = {};
    GOTH.Cosmetics.starterIds().forEach(function (id) { owned[id] = true; });
    var data = { owned: owned, equipped: { dress: 'dress_pink', crown: 'crown_flower' } };
    try { localStorage.setItem(cosmKey(childId), JSON.stringify(data)); } catch (e) {}
    return data;
  } catch (e) {
    return { owned: {}, equipped: {} };
  }
}
function saveCosmetics(childId, data) {
  try { localStorage.setItem(cosmKey(childId), JSON.stringify(data)); } catch (e) {}
}
// grant an item (used by raids / chore rewards later). returns true if newly granted.
function grantCosmetic(childId, id) {
  var data = loadCosmetics(childId);
  if (data.owned[id]) return false;
  data.owned[id] = true;
  saveCosmetics(childId, data);
  return true;
}

function DressUp(props) {
  var childId = props.childId;
  var initial = loadCosmetics(childId);
  var ownedState = useState(initial.owned);
  var owned = ownedState[0], setOwned = ownedState[1];
  var equippedState = useState(initial.equipped);
  var equipped = equippedState[0], setEquipped = equippedState[1];
  var slotState = useState('dress');
  var slot = slotState[0], setSlot = slotState[1];

  function tryOn(item) {
    if (!owned[item.id]) {
      // locked — tell the child how to earn it (no dead-end, just info)
      var how = item.source === 'legendary' ? 'Do a special mission to earn this!' : 'Find this on an adventure!';
      Voice.speak(item.name + '. ' + how);
      return;
    }
    var next = Object.assign({}, equipped); next[item.slot] = item.id;
    setEquipped(next);
    saveCosmetics(childId, { owned: owned, equipped: next });
    Sfx.sparkle && Sfx.sparkle();
    Voice.speak('You look beautiful!');
  }

  var items = G.Cosmetics.bySlot(slot);
  var dressArt = equipped.dress ? G.Cosmetics.get(equipped.dress) : null;
  var crownArt = equipped.crown ? G.Cosmetics.get(equipped.crown) : null;

  return (
    React.createElement('div', { className: 'dressup-overlay' },
      React.createElement('div', { className: 'dressup-top' },
        React.createElement('button', { className: 'du-close', onClick: props.onClose }, '← Back'),
        React.createElement('div', { className: 'du-title' }, '👗 Dress Up')
      ),
      // ---- the live princess preview (layered) ----
      React.createElement('div', { className: 'du-stage' },
        React.createElement('img', { className: 'du-layer du-base', src: 'princess-base.png', alt: 'princess' }),
        dressArt ? React.createElement('img', { className: 'du-layer du-dress', src: dressArt.art, alt: dressArt.name }) : null,
        crownArt ? React.createElement('img', { className: 'du-layer du-crown', src: crownArt.art, alt: crownArt.name }) : null
      ),
      // ---- slot tabs (Dress / Crown) ----
      React.createElement('div', { className: 'du-slots' },
        React.createElement('button', { className: 'du-slot' + (slot === 'dress' ? ' on' : ''), onClick: function () { setSlot('dress'); } }, '👗 Dresses'),
        React.createElement('button', { className: 'du-slot' + (slot === 'crown' ? ' on' : ''), onClick: function () { setSlot('crown'); } }, '👑 Crowns')
      ),
      // ---- the item tray ----
      React.createElement('div', { className: 'du-tray' },
        items.map(function (item) {
          var isOwned = !!owned[item.id];
          var isOn = equipped[item.slot] === item.id;
          return React.createElement('button', {
            key: item.id,
            className: 'du-item rarity-' + item.rarity + (isOn ? ' on' : '') + (isOwned ? '' : ' locked'),
            onClick: function () { tryOn(item); }
          },
            React.createElement('img', { src: item.art, alt: item.name }),
            isOwned ? null : React.createElement('span', { className: 'du-lock' }, item.source === 'legendary' ? '⭐' : '🔒'),
            isOn ? React.createElement('span', { className: 'du-check' }, '✓') : null
          );
        })
      )
    )
  );
}


// Ember's "living" stage on the Home screen. The dragon ships four cut-out poses
// that share the SAME framing (rest / wave / fire / jump), so we hard-CUT between
// them (only one shown at a time — never cross-faded, which is what used to ghost
// two poses together). Ember idles with a gentle breathe and every few seconds
// performs a little routine, and reacts with a pose when tapped. Species without
// pose art fall back to the proven static-portrait + CSS motion (unchanged).
// ---- Layered puppet rig (the "flawless" path) -------------------------------
// When 7 matching ember-*.png cut-out layers exist, Ember is assembled from them
// and animated joint-by-joint in CSS: gentle breathing, blinking (hide the open
// eyes to reveal the closed eyes painted on the head), slow wing-flaps + tail
// sway, and jaw-open reactions. All layers share ONE canvas/size/position, so
// stacking them at inset:0 reassembles her perfectly. Pivot %s in the CSS are
// first-pass and get calibrated against the real art once the layers land.
var EMBER_RIG_LAYERS = ['body', 'head', 'eyes', 'jaw', 'wing-near', 'wing-far', 'tail'];
function EmberRig(props) {
  var asleep = props.asleep;
  var fxState = useState('idle'); var fx = fxState[0], setFx = fxState[1];
  var busyRef = useRef(false);
  var holdRef = useRef(null);
  function L(name) { return './ember-' + name + '.png'; }

  function play(kind) {
    if (asleep) return;
    busyRef.current = true; setFx(kind);
    if (props.onEmote) props.onEmote(kind === 'fire' ? '🔥' : '❤️');
    clearTimeout(holdRef.current);
    holdRef.current = setTimeout(function () { setFx('idle'); busyRef.current = false; }, kind === 'fire' ? 1500 : 900);
  }
  useEffect(function () {
    if (!props.pokeRef) return;
    props.pokeRef.current = function () {
      if (asleep) return false;
      play(Math.random() < 0.4 ? 'fire' : 'happy');
      return true;
    };
  });
  useEffect(function () {
    if (asleep) return;
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.body.classList.contains('motion-force'); } catch (e) {}
    if (reduce) return;
    var id = setInterval(function () {
      if (busyRef.current || Math.random() < 0.5) return;
      play(Math.random() < 0.35 ? 'fire' : 'happy');
    }, 5200);
    return function () { clearInterval(id); };
  }, [asleep]);
  useEffect(function () { return function () { clearTimeout(holdRef.current); }; }, []);

  return React.createElement('div', { className: 'pet-stage ember-rig fx-' + (asleep ? 'sleep' : fx), 'aria-label': props.alt || '' },
    React.createElement('img', { className: 'erl l-wingfar', src: L('wing-far'), alt: '' }),
    React.createElement('img', { className: 'erl l-wingnear', src: L('wing-near'), alt: '' }),
    React.createElement('img', { className: 'erl l-tail', src: L('tail'), alt: '' }),
    React.createElement('img', { className: 'erl l-body', src: L('body'), alt: '' }),
    React.createElement('div', { className: 'er-head' },
      React.createElement('img', { className: 'erl l-head', src: L('head'), alt: '' }),
      React.createElement('img', { className: 'erl l-jaw', src: L('jaw'), alt: '' }),
      React.createElement('img', { className: 'erl l-eyes', src: L('eyes'), alt: props.alt || '' })
    ),
    fx === 'fire' ? React.createElement('span', { key: 'fx', className: 'ember-firefx' }) : null,
    React.createElement('span', { key: 'amb', className: 'amb-embers' },
      [0, 1, 2, 3].map(function (i) {
        return React.createElement('span', { key: i, className: 'amb-ember', style: { left: (12 + i * 22) + '%', animationDelay: (i * 1.3) + 's' } });
      }))
  );
}

var EMBER_POSES = {
  rest: { file: 'cheer2', cls: 'ep-rest', hold: 0,    emote: null },
  wave: { file: 'cheer1', cls: 'ep-wave', hold: 1500, emote: '👋' },
  jump: { file: 'cheer4', cls: 'ep-jump', hold: 1300, emote: '✨' },
  fire: { file: 'cheer3', cls: 'ep-fire', hold: 1600, emote: '🔥' },
};
var EMBER_IDLE_ACTS = ['wave', 'fire', 'jump', 'wave', 'fire']; // weighted toward wave/fire
function EmberStage(props) {
  var sp = props.species;
  var asleep = props.asleep;
  var modeState = useState('probing'); var mode = modeState[0], setMode = modeState[1];
  var actState = useState('rest'); var act = actState[0], setAct = actState[1];
  var rigState = useState(sp === 'DRAGON' ? 'probing' : 'no'); var rig = rigState[0], setRig = rigState[1];
  var busyRef = useRef(false);
  var holdRef = useRef(null);
  function file(name) { return 'guardian-' + sp.toLowerCase() + '-' + name + '.png'; }

  // Probe for the layered rig art first — it's the flawless path when present.
  useEffect(function () {
    if (sp !== 'DRAGON') { setRig('no'); return; }
    var alive = true; setRig('probing');
    var need = EMBER_RIG_LAYERS; var ok = 0, done = 0;
    need.forEach(function (n) {
      var im = new Image();
      im.onload = function () { ok++; fin(); };
      im.onerror = function () { fin(); };
      im.src = './ember-' + n + '.png';
    });
    function fin() { done++; if (done < need.length || !alive) return; setRig(ok === need.length ? 'yes' : 'no'); }
    return function () { alive = false; };
  }, [sp]);

  // Probe whether this species ships the cut-out poses; only then go "live".
  useEffect(function () {
    var alive = true; setMode('probing');
    var need = ['cheer1', 'cheer2', 'cheer3', 'cheer4']; var ok = 0, done = 0;
    need.forEach(function (n) {
      var im = new Image();
      im.onload = function () { ok++; fin(); };
      im.onerror = function () { fin(); };
      im.src = './' + file(n);
    });
    function fin() { done++; if (done < need.length || !alive) return; setMode(ok === need.length ? 'live' : 'plain'); }
    return function () { alive = false; };
  }, [sp]);

  function play(name) {
    if (mode !== 'live' || asleep) return;
    var a = EMBER_POSES[name]; if (!a) return;
    busyRef.current = true; setAct(name);
    if (a.emote && props.onEmote) props.onEmote(a.emote);
    clearTimeout(holdRef.current);
    holdRef.current = setTimeout(function () { setAct('rest'); busyRef.current = false; }, a.hold);
  }
  // Let the parent's tap handler poke Ember into a happy reaction.
  useEffect(function () {
    if (!props.pokeRef || rig === 'yes') return; // the rig wires its own poke
    props.pokeRef.current = function () {
      if (mode !== 'live' || asleep) return false;
      var picks = ['wave', 'jump', 'fire'];
      play(picks[Math.floor(Math.random() * picks.length)]);
      return true;
    };
  });
  // Autonomous idle life — a little routine every few seconds.
  useEffect(function () {
    if (mode !== 'live' || asleep || rig === 'yes') return;
    var reduce = false;
    try { reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches && !document.body.classList.contains('motion-force'); } catch (e) {}
    if (reduce) return;
    var id = setInterval(function () {
      if (busyRef.current || Math.random() < 0.4) return;
      play(EMBER_IDLE_ACTS[Math.floor(Math.random() * EMBER_IDLE_ACTS.length)]);
    }, 4800);
    return function () { clearInterval(id); };
  }, [mode, asleep, rig]);
  useEffect(function () { return function () { clearTimeout(holdRef.current); }; }, []);

  // Best path: the layered puppet rig (handles its own idle, reactions, sleep).
  if (rig === 'yes') {
    return React.createElement(EmberRig, { asleep: asleep, pokeRef: props.pokeRef, onEmote: props.onEmote, alt: props.alt });
  }
  // Asleep, or a species without pose art -> the proven AnimArt behaviour.
  if (asleep || mode === 'plain' || mode === 'probing' || rig === 'probing') {
    var m = guardianMotion(sp, props.level, asleep ? 'sleep' : 'idle');
    return React.createElement('div', { className: 'pet-stage ' + m.cls },
      React.createElement(AnimArt, { frames: m.frames, fallback: m.fallback, fps: m.fps, fade: m.fade, emoji: props.emoji, alt: props.alt }));
  }
  // Live pose machine: all poses stacked, only the active one shown (hard cut).
  var cls = EMBER_POSES[act].cls;
  return React.createElement('div', { className: 'pet-stage ember-stage ' + cls },
    Object.keys(EMBER_POSES).map(function (k) {
      return React.createElement('img', {
        key: k, alt: k === 'rest' ? props.alt : '',
        className: 'ember-pose' + (k === act ? ' on' : ''),
        src: './' + file(EMBER_POSES[k].file),
      });
    }),
    cls === 'ep-fire' ? React.createElement('span', { key: 'fx', className: 'ember-firefx' }) : null,
    React.createElement('span', { key: 'amb', className: 'amb-embers' },
      [0, 1, 2, 3].map(function (i) {
        return React.createElement('span', { key: i, className: 'amb-ember', style: { left: (12 + i * 22) + '%', animationDelay: (i * 1.3) + 's' } });
      }))
  );
}


function HomeScreen(props) {
  const state = props.state;
  const g = state.guardian;
  const [flash, setFlash] = useState({});
  const [showDressUp, setShowDressUp] = useState(false);
  const pokeRef = useRef(function () {});
  const prevRef = useRef({ gold: g ? g.gold : 0, energy: g ? g.energy : 0 });
  useEffect(function () {
    if (!g) return;
    const f = {};
    if (g.gold > prevRef.current.gold) f.gold = true;
    if (g.energy > prevRef.current.energy) f.energy = true;
    prevRef.current = { gold: g.gold, energy: g.energy };
    if (f.gold || f.energy) {
      setFlash(f);
      const id = setTimeout(function () { setFlash({}); }, 750);
      return function () { clearTimeout(id); };
    }
  }, [g && g.gold, g && g.energy]);
  const J = useQuestJuice(props.store);
  const [emotes, setEmotes] = useState([]);
  const reactRef = useRef(0);
  function emote(icon) {
    const e = { id: Date.now() + Math.random(), icon: icon, x: 28 + Math.random() * 44 };
    setEmotes(function (list) { return list.concat(e); });
    setTimeout(function () {
      setEmotes(function (list) { return list.filter(function (x) { return x.id !== e.id; }); });
    }, 1700);
  }
  // Friendly things the guardian 'says' when tapped — spoken aloud so a NON-READER
  // discovers that tapping the dragon makes it talk. The guardian IS the tutorial.
  const PET_LINES = [
    'Hi! I\'m so happy you\'re here!',
    'Yay! That tickles! Hehe!',
    'I love spending time with you!',
    'You\'re my best friend!',
    'Let\'s go on an adventure together!',
    'Tap my missions to help me grow!',
  ];
  function guardianSpeak() {
    var line = PET_LINES[reactRef.current % PET_LINES.length];
    Voice.speak((g ? g.name : 'Your friend') + ' says: ' + line);
  }
  function petTap() {
    addBondTap(); // play-first: each tap builds the bond that unlocks mission guidance
    guardianSpeak(); // ALWAYS talk back — this is how a non-reader learns the dragon is alive
    Sfx.pet();
    // Poke Ember into a real pose reaction (wave / jump / fire). If she's asleep or
    // the species has no pose art, fall back to a simple heart so a tap is never dead.
    if (!(pokeRef.current && pokeRef.current())) emote('❤️');
  }
  if (!g) return null;
  const sp = speciesOf(g.species);
  const xpNeeded = G.Leveling.xpToNext(g.level);
  const pct = Math.min(100, Math.round((g.xp / xpNeeded) * 100));
  const quick = state.questBoard.filter(function (b) { return b.remainingToday > 0; }).slice(0, 3);
  return (
    <React.Fragment>
      <div className="card hero">
        <div className={"hero-art" + (props.guide === "pet-guardian" ? " guide-glow" : "")} onClick={petTap}>
          <EmberStage species={g.species} level={g.level} asleep={g.energy <= 8}
            pokeRef={pokeRef} onEmote={emote} emoji={sp.emoji} alt={sp.name} />
          {emotes.map(function (e) {
            return <span key={e.id} className="emote" style={{ left: e.x + '%' }}>{e.icon}</span>;
          })}
          <div className="hero-name">
            <span className="display">{g.name}</span>
            <span className="lv-pill">Lv {g.level}</span>
          </div>
        </div>
        <button className="talk-to-guardian" onClick={function (e) { e.stopPropagation(); guardianSpeak(); }}
          aria-label={'Talk to ' + g.name}>
          <span className="ttg-icon">🔊</span>
          <span className="ttg-text">Talk to {g.name}!</span>
        </button>
        <button className="dressup-btn" onClick={function (e) { e.stopPropagation(); setShowDressUp(true); }}
          aria-label="Dress up your guardian" title="Dress Up!">
          <span className="ttg-icon">👗</span>
        </button>
        {showDressUp && S.selectActiveChild(state) && (
          <DressUp childId={S.selectActiveChild(state).id} onClose={function () { setShowDressUp(false); }} />
        )}
        <div className="hero-body">
          <div className="xp-bar"><span style={{ width: pct + '%' }} /></div>
          <div className="xp-row"><span>XP</span><span className="num">{g.xp} / {xpNeeded}</span></div>
          <div className="chips">
            <span className={'chip gold' + (flash.gold ? ' flash' : '')}>✦ <b>{g.gold}</b></span>
            <span className={'chip energy' + (flash.energy ? ' flash' : '')}>⚡ <b>{g.energy}/{g.maxEnergy}</b></span>
            <span className="chip heart">♥ <b>{g.affection}</b></span>
            <span className="chip streak">🔥 <b>{S.selectGlobalStreak(state)}</b></span>
          </div>
        </div>
      </div>

      <KeeperCard state={state} />

      <FlameCard state={state} store={props.store} />

      {state.pending.length > 0 && (
        <div className="card">
          <h2>Waiting for the Keeper</h2>
          {state.pending.map(function (sub) {
            const b = state.questBoard.find(function (x) { return x.quest.id === sub.questId; });
            return (
              <div className="pend-row" key={sub.id}>
                <span>{b ? b.quest.icon : '⭐'}</span>
                <span style={{ flex: 1 }}>{b ? b.quest.title : sub.questId}</span>
                <span className="badge-wait">awaiting approval</span>
              </div>
            );
          })}
          <p className="note">Rewards arrive when a parent approves.</p>
        </div>
      )}

      <div className="card">
        <h2>Today's quests</h2>
        {quick.length === 0 && <p className="note" style={{ marginTop: 0 }}>Every quest is done for today. The hearth is proud of you.</p>}
        {quick.map(function (b) {
          const pc = state.pending.filter(function (s) { return s.questId === b.quest.id; }).length;
          return (
            <div className={'q-card' + (J.sent[b.quest.id] ? ' justSent' : '')} key={b.quest.id}>
              <QBurst J={J} qid={b.quest.id} />
              {J.ok[b.quest.id] && <span className="stamp">✉️ SENT</span>}
              <span className="q-icon rock">{b.quest.icon}</span>
              <span className="q-main">
                <span className="q-title" onClick={function () { Voice.say(b.quest.title); }}>{b.quest.title}</span>
                <div className="q-sub">
                  {qdDots(b.quest.maxPerDay, b.quest.maxPerDay - b.remainingToday)}
                  {b.remainingToday} left today · +{b.quest.reward.energy}⚡ +{b.quest.reward.coins}✦
                  {pc > 0 && <span className="sent-chip">✉️ {pc} with the Keeper</span>}
                </div>
              </span>
              <button className={'mini ' + (J.ok[b.quest.id] ? 'sentok' : 'go')}
                onClick={function (e) { J.submit(b.quest, e); }}>
                {J.ok[b.quest.id] ? '✓ Sent!' : 'I did it!'}
              </button>
            </div>
          );
        })}
        <button className="btn" style={{ width: '100%', marginTop: 4 }} onClick={function () { props.setTab('quests'); }}>
          See the whole quest board ⭐
        </button>
      </div>
      <QFlights J={J} />
      <ProudMoment J={J} g={g} />
    </React.Fragment>
  );
}

/* ---------------- quests ---------------- */
function QuestsScreen(props) {
  const state = props.state;
  const g = state.guardian;
  const J = useQuestJuice(props.store);
  const [cheer, setCheer] = useState(false);
  useEffect(function () {
    if (J.tick === 0) return;
    setCheer(true);
    const id = setTimeout(function () { setCheer(false); }, 700);
    return function () { clearTimeout(id); };
  }, [J.tick]);
  const groups = {};
  state.questBoard.forEach(function (b) {
    const c = b.quest.category;
    if (!groups[c]) groups[c] = [];
    groups[c].push(b);
  });
  // GUIDANCE: when guiding a new player, find the first quest they can tap so we can glow it.
  var firstAvailQ = null;
  if (props.guide === 'first-quest') {
    for (var gi = 0; gi < state.questBoard.length; gi++) {
      if (state.questBoard[gi].remainingToday > 0) { firstAvailQ = state.questBoard[gi].quest.id; break; }
    }
  }
  return (
    <React.Fragment>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        {g && (
          <span className={'qpet' + (cheer ? ' hop' : '')}>
            <Art srcs={stageArt(g.species, g.level)} emoji={speciesOf(g.species).emoji} alt={g.name} />
          </span>
        )}
        <h1 style={{ fontSize: 24, marginBottom: 4, flex: 1 }}>Guardian Missions</h1>
        <span className="chip streak">🔥 <b>{S.selectGlobalStreak(state)}</b></span>
      </div>
      <QFlights J={J} />
      <ProudMoment J={J} g={g} />
      <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>Do it in the real world first, then tap "I did it!" — a parent releases the reward.</p>
      {state.questBoard.length > 0 && state.questBoard.every(function (x) { return x.remainingToday === 0; }) && (
        <div className="card" style={{ borderColor: '#6B5326', textAlign: 'center' }}>
          <div className="burst" style={{ fontSize: 40 }}>🌟</div>
          <h2 style={{ marginBottom: 4 }}>Every mission done today! 🌟</h2>
          <p className="note" style={{ margin: 0 }}>The hearth glows brighter tonight. Rest, hero.</p>
        </div>
      )}
      {Object.keys(CATEGORY).map(function (cat) {
        const list = groups[cat];
        if (!list || list.length === 0) return null;
        return (
          <React.Fragment key={cat}>
            <div className="cat-label">
              <span>{CATEGORY[cat].icon}</span>
              <span className="eyebrow">{CATEGORY[cat].label}</span>
              <span className="cat-bar"><i style={{
                width: Math.round(100 * list.reduce(function (s, x) { return s + (x.quest.maxPerDay - x.remainingToday); }, 0)
                  / Math.max(1, list.reduce(function (s, x) { return s + x.quest.maxPerDay; }, 0))) + '%'
              }} /></span>
            </div>
            {list.map(function (b) {
              const spent = b.remainingToday === 0;
              const pc = state.pending.filter(function (s) { return s.questId === b.quest.id; }).length;
              return (
                <div className={'q-card' + (J.sent[b.quest.id] ? ' justSent' : '')} key={b.quest.id} style={spent ? { opacity: 0.55 } : null}>
                  <QBurst J={J} qid={b.quest.id} />
              {J.ok[b.quest.id] && <span className="stamp">✉️ SENT</span>}
                  <span className="q-icon rock">{b.quest.icon}</span>
                  <span className="q-main">
                    <span className="q-title" onClick={function () { Voice.say(b.quest.title); }}>{b.quest.title}</span>
                    <div className="q-sub">
                      {qdDots(b.quest.maxPerDay, b.quest.maxPerDay - b.remainingToday)}
                      {spent ? 'done for today ✓' : b.remainingToday + ' left today'}
                      {pc > 0 && <span className="sent-chip">✉️ {pc} with the Keeper</span>}
                    </div>
                    <div className="q-rewards">
                      <span className="rwd energy">+{b.quest.reward.energy}⚡</span>
                      <span className="rwd coins">+{b.quest.reward.coins}✦</span>
                      <span className="rwd xp">+{b.quest.reward.xp} XP</span>
                    </div>
                  </span>
                  <button className={'mini ' + (J.ok[b.quest.id] ? 'sentok' : 'go') + ((firstAvailQ === b.quest.id && !J.ok[b.quest.id]) ? ' guide-glow' : '')}
                    style={spent ? { opacity: 0.65 } : null}
                    onClick={function (e) {
                      if (spent) {
                        Sfx.tap();
                        props.store.dispatch({ type: G.ActionTypes.TOAST_SHOW, scope: 'main', kind: 'ok', text: '🌙 All done for today — this quest returns at midnight!' });
                        return;
                      }
                      J.submit(b.quest, e);
                    }}>
                    {J.ok[b.quest.id] ? '✓ Sent!' : (spent ? 'Done ✓' : 'I did it!')}
                  </button>
                </div>
              );
            })}
          </React.Fragment>
        );
      })}
      {state.pending.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <h2>Waiting for the Keeper</h2>
          {state.pending.map(function (sub) {
            const b = state.questBoard.find(function (x) { return x.quest.id === sub.questId; });
            return (
              <div className="pend-row" key={sub.id}>
                <span>{b ? b.quest.icon : '⭐'}</span>
                <span style={{ flex: 1 }}>{b ? b.quest.title : sub.questId}</span>
                <span className="badge-wait">awaiting approval</span>
              </div>
            );
          })}
        </div>
      )}
    </React.Fragment>
  );
}

/* ---------------- battles ---------------- */
const ENEMIES = {
  dgn_glade: { name: 'Glade Sprite', emoji: '🍄' },
  dgn_tide: { name: 'Tide Serpent', emoji: '🐍' },
  dgn_ember: { name: 'Ember Imp', emoji: '👹' },
  dgn_sky: { name: 'Sky Harpy', emoji: '🦅' },
  dgn_void: { name: 'Void Wisp', emoji: '👻' },
};
const ATTACK_NAMES = ['Ember Dash', 'Star Pounce', 'Hearth Howl', 'Acorn Slam', 'Moonlight Swipe', 'Brave Tackle', 'Sparkle Spin'];

function BattleOverlay(props) {
  const g = props.g;
  const foe = ENEMIES[props.def.id] || { name: 'Shadow', emoji: '👾' };
  const foeFile = 'enemy-' + props.def.id.replace('dgn_', '') + '.png';
  const atkFrames = frameSet(g.species, 'attack', 2);
  const [hasAtk, setHasAtk] = useState(false);
  useEffect(function () {
    let alive = true;
    const im = new Image();
    im.onload = function () { if (alive) setHasAtk(true); };
    im.onerror = function () { if (alive) setHasAtk(false); };
    im.src = './' + atkFrames[0];
    return function () { alive = false; };
  }, [atkFrames.join('|')]);
  const plan = useRef(null);
  if (!plan.current) {
    const rand = G.RNG.mulberry32(((props.run.seed >>> 0) + 13) >>> 0);
    const hits = 3 + Math.floor(rand() * 3);
    const maxHp = 24 + Math.floor(rand() * 16);
    const dmgs = [];
    let left = maxHp;
    for (let i = 0; i < hits; i++) {
      const d = i === hits - 1 ? left : Math.max(2, Math.floor(maxHp / hits) + Math.floor(rand() * 5) - 2);
      const take = Math.min(d, left);
      dmgs.push(take);
      left -= take;
    }
    if (left > 0) dmgs[dmgs.length - 1] += left;
    plan.current = {
      maxHp: maxHp,
      dmgs: dmgs,
      crit: Math.floor(rand() * dmgs.length),
      names: dmgs.map(function () { return ATTACK_NAMES[Math.floor(rand() * ATTACK_NAMES.length)]; }),
      dodges: dmgs.map(function (x, i) { return i > 0 && rand() < 0.45; }),
    };
  }
  const P = plan.current;
  const [hp, setHp] = useState(P.maxHp);
  const [idx, setIdx] = useState(0);
  const [lock, setLock] = useState(false);
  const [fx, setFx] = useState({});
  const [nums, setNums] = useState([]);
  const [phase, setPhase] = useState('intro');
  const [foeFail, setFoeFail] = useState(false);
  const [busy, setBusy] = useState(false);
  function safeSfx(name) { try { if (Sfx[name]) Sfx[name](); } catch (e) {} }
  useEffect(function () {
    try { Sfx.growl(); } catch (e) {}
    const t = setTimeout(function () { setPhase('fight'); }, 600);
    return function () { clearTimeout(t); };
  }, []);
  // SAFETY NET: lock should only be true briefly during an attack animation. If it ever
  // stays true longer than that (a missed timeout, a swallowed error), force-release it so
  // the ATTACK button can never be permanently disabled.
  useEffect(function () {
    if (!lock) return;
    const safety = setTimeout(function () { setLock(false); }, 2500);
    return function () { clearTimeout(safety); };
  }, [lock]);
  function popNum(val, crit) {
    const n = { id: Date.now() + Math.random(), val: val, crit: crit, x: 52 + Math.random() * 22, y: 24 + Math.random() * 12 };
    setNums(function (list) { return list.concat(n); });
    setTimeout(function () {
      setNums(function (list) { return list.filter(function (z) { return z.id !== n.id; }); });
    }, 900);
  }
  function attack() {
    if (lock || phase !== 'fight') return;
    const i = idx;
    if (i >= P.dmgs.length) return;
    setLock(true);
    safeSfx('tap');
    // APPLY GAME STATE IMMEDIATELY (synchronous) so a throwing animation/sound can never strand it.
    const crit = i === P.crit;
    const nhp = Math.max(0, hp - P.dmgs[i]);
    setHp(nhp);
    setIdx(i + 1);
    popNum(P.dmgs[i], crit);
    // animations + sound are best-effort and fully wrapped — they can never break the fight.
    safeSfx(crit ? 'crit' : 'hit');
    setFx({ hurt: true, shake: true, atkName: P.names[i], crit: crit, lunge: true });
    setTimeout(function () {
      try {
        if (nhp <= 0) {
          setFx({ defeat: true });
          safeSfx('defeat');
          setTimeout(function () { setPhase('win'); safeSfx('victory'); }, 700);
        } else {
          setFx({});
        }
      } catch (e) {}
      setLock(false); // ALWAYS release
    }, 500);
  }
  async function finish() {
    if (busy) return;
    setBusy(true);
    var r = null;
    try {
      r = await props.store.dispatch(A.claimDungeon(props.runId));
    } catch (e) {
      r = null;
    }
    setBusy(false); // ALWAYS reset — never leave the claim button permanently disabled
    // hand the real rewards up so the Hearth can play the return celebration
    props.onClose(r && r.ok ? r : null);
  }
  const pct = Math.round(100 * hp / P.maxHp);
  const hpClass = pct <= 30 ? 'hp low' : pct <= 60 ? 'hp mid' : 'hp';
  return (
    <div className="battle">
      <div className="bd">
        <Art srcs={[props.def.id.replace('dgn_', 'dungeon-') + '.jpg']} emoji="" alt="" />
      </div>
      <div className="b-top">
        <div className="b-foe-name">
          <span>{foe.emoji} {foe.name}</span>
          <span className="num" style={{ fontSize: 13, color: 'var(--dim)' }}>{hp}/{P.maxHp}</span>
        </div>
        <div className={hpClass}><i style={{ width: pct + '%' }} /></div>
      </div>
      <div className={'arena' + (fx.shake ? ' shake' : '')}>
        {phase === 'intro' && <div className="atkban">A wild {foe.name} appears!</div>}
        {phase === 'intro' && <Say text={'A wild ' + foe.name + ' appears!'} />}
        {fx.atkName && phase === 'fight' && (
          <div className={'atkban' + (fx.crit ? ' crit' : '') + (fx.dodgeTag ? ' dodge' : '')}>
            {fx.crit ? 'CRITICAL! ' : ''}{fx.atkName}{fx.crit || fx.dodgeTag ? '' : '!'}
          </div>
        )}
        {fx.hurt && <span className="clash" style={{ right: '20%', bottom: '40%' }}>💥</span>}
        <div className={'b-foe' + (fx.hurt ? ' hurt' : '') + (fx.swipe ? ' swipe' : '') + (fx.defeat || phase === 'win' ? ' defeat' : '')}>
          {!foeFail ? (
            <img src={'./' + foeFile} alt={foe.name} onError={function () { setFoeFail(true); }} />
          ) : (
            <span className="fallback">{foe.emoji}</span>
          )}
        </div>
        <div className={'b-me' + (fx.lunge ? ' lunge' : '') + (fx.hop2 ? ' hop2' : '') + (hasAtk ? ' has-fire' : '')}>
          {hasAtk ? (
            <div className="anim-stack">
              <img className="anim-frame fr-calm" alt={g.name} src={'./' + atkFrames[0]}
                style={{ opacity: fx.lunge ? 0 : 1, transition: 'opacity 80ms ease-out' }} />
              <img className={'anim-frame fr-fire' + (fx.lunge ? ' flicker' : '')} alt="" src={'./' + atkFrames[1]}
                style={{ opacity: fx.lunge ? 1 : 0, transition: 'opacity 80ms ease-out' }} />
            </div>
          ) : (
            <Art srcs={stageArt(g.species, g.level)} emoji={speciesOf(g.species).emoji} alt={g.name} />
          )}
        </div>
        {nums.map(function (n) {
          return (
            <span key={n.id} className={'dmgnum' + (n.crit ? ' crit' : '')}
              style={{ left: n.x + '%', top: n.y + '%' }}>
              -{n.val}
            </span>
          );
        })}
        {phase === 'win' && (
          <div className="victory-wrap">
            <span className="vspark" style={{ left: '58%', top: '34%', '--dx': '-50px', '--dy': '-60px' }}>✨</span>
            <span className="vspark" style={{ left: '66%', top: '30%', '--dx': '54px', '--dy': '-48px' }}>⭐</span>
            <span className="vspark" style={{ left: '62%', top: '38%', '--dx': '10px', '--dy': '-76px' }}>💫</span>
            <Say text="Victory!" />
            <div className="victory-text">VICTORY!</div>
            <button className="btn primary pulse" style={{ minWidth: '70%' }} disabled={busy} onClick={finish}>
              {busy ? 'Opening…' : 'Open the haul 🎒'}
            </button>
          </div>
        )}
      </div>
      <div className="b-controls">
        {phase === 'fight' && (
          <React.Fragment>
            <button className="btn primary" disabled={lock} onClick={attack} onPointerUp={function (e) { if (e.pointerType !== "mouse") attack(); }}>⚔️ ATTACK</button>
            <button className="btn" style={{ flex: '0 0 auto' }} disabled={busy} onClick={finish}>Skip ⏭</button>
          </React.Fragment>
        )}
        {phase === 'intro' && <button className="btn primary" style={{ width: '100%' }} onClick={function () { setPhase('fight'); }}>⚔️ Begin!</button>}
      </div>
    </div>
  );
}

/* ---------------- raids ---------------- */
/* ---------------- raid return celebration (W2.6) ---------------- */
// A magical 5-10s reveal of the rewards the guardian ACTUALLY earned. No combat replay —
// it celebrates real raid data (gold/xp/drops) with the real guardian art. Fully skippable.
// ==== W2.7 DEPARTURE CEREMONY DATA ====
// Per-dungeon flavor for the send-off (Sol's call + difficulty + what might be found).
// Difficulty/loot ranges are derived from the REAL dungeon def — no fake numbers.
const RAID_FLAVOR = {
  dgn_glade:  { scene: 'the Whispering Glade', call: 'A whisper from the Whispering Glade has reached us. Something gentle waits among the ferns…', advice: 'The glade is calm today. A brave Guardian may find a quiet treasure.', stars: 1 },
  dgn_tide:   { scene: 'the Tide Caverns', call: 'The tide has pulled back, revealing the Tide Caverns. Secrets glimmer in the dark…', advice: 'The waters are kind right now. Step carefully and the sea may share its gifts.', stars: 2 },
  dgn_ember:  { scene: 'Ember Hollow', call: 'A warm glow rises from Ember Hollow. The embers are whispering of treasure…', advice: 'The Hollow is restless but rewarding. A bold heart will be rewarded.', stars: 3 },
  dgn_sky:    { scene: 'the Sky Bastion', call: 'High above the clouds, the Sky Bastion calls. The winds carry a promise…', advice: 'The skies favor the patient. This is a long and wondrous journey.', stars: 4 },
  dgn_void:   { scene: 'the Voidwalk Ruins', call: 'From the deepest dark, the Voidwalk Ruins stir. Ancient power sleeps there…', advice: 'The Ruins are not for the faint of heart, but the bravest find legends.', stars: 5 },
};
function flavorOf(defId) {
  return RAID_FLAVOR[defId] || { scene: 'a faraway land', call: 'A distant land is calling your Guardian on an adventure…', advice: 'A brave Guardian may find wonderful things.', stars: 2 };
}

// PREVIEW: shown when the child taps "Set out" — they choose an adventure, not press a timer.
function DeparturePreview(props) {
  var def = props.def, fl = flavorOf(def.id);
  var stars = '';
  for (var i = 0; i < 5; i++) stars += (i < fl.stars) ? '\u2B50' : '\u2606';
  return (
    <div className="raid-return depart-preview">
      <button className="rr-skip" onClick={props.onCancel}>Back</button>
      <div className="dp-art">
        <Art srcs={[def.id.replace('dgn_', 'dungeon-') + '.jpg']} emoji="🗺️" alt={def.name} />
      </div>
      <div className="dp-title">{def.name}</div>
      <div className="dp-stars">{stars}</div>
      <div className="dp-row">⏳ Journey time: {def.durationMin} minutes</div>
      <div className="dp-row">⚡ Energy: {props.energyCost}</div>
      <div className="dp-discoveries">
        <div className="dp-d-title">✨ Possible Discoveries</div>
        <div className="dp-d-item">💰 {def.gold[0]}–{def.gold[1]} Gold</div>
        <div className="dp-d-item">⭐ {def.xp[0]}–{def.xp[1]} Guardian XP</div>
        <div className="dp-d-item">🎁 Hidden treasures await</div>
      </div>
      <div className="dp-advice">🔥 “{fl.advice}”</div>
      <button className="sol-cta dp-go" onClick={props.onBegin}>Begin the Journey ✦</button>
    </div>
  );
}

// CEREMONY: the 3-5s send-off scene, then the real raid starts.
function DepartureCeremony(props) {
  var def = props.def, fl = flavorOf(def.id);
  var STAGES = ['call', 'ready', 'pack', 'depart', 'done'];
  var _a = useState(0); var idx = _a[0]; var setIdx = _a[1];
  var stage = STAGES[idx];

  useEffect(function () {
    if (stage === 'call') Voice.speak(fl.call);
    if (stage === 'ready') { Sfx.sparkle && Sfx.sparkle(); Voice.speak((props.g ? props.g.name : 'Your Guardian') + ' says: Let us go on an adventure! I will bring back treasures to make our island more beautiful!'); }
    if (stage === 'pack') { Sfx.coin && Sfx.coin(); }
    if (stage === 'depart') { Sfx.gate && Sfx.gate(); Voice.speak('I will be back with wonderful discoveries!'); }
    if (stage === 'done') { props.onComplete(); return; } // hand off to the real raid start
    var dur = stage === 'call' ? 2400 : stage === 'depart' ? 1600 : 1300;
    var id = setTimeout(function () { setIdx(function (s) { return Math.min(s + 1, STAGES.length - 1); }); }, dur);
    return function () { clearTimeout(id); };
  }, [idx]);

  function skip() { Voice.stop(); props.onComplete(); }
  var passed = function (n) { return STAGES.indexOf(n) <= idx; };

  return (
    <div className="raid-return depart-cere">
      <button className="rr-skip" onClick={skip}>Skip ›</button>
      <div className="dc-scene">{def.name}</div>

      {/* portal + guardian, marching in then walking through */}
      <div className="rr-portal">
        <div className="rr-portal-glow" />
        <div className={'rr-guardian ' + (passed('depart') ? 'mood-depart' : 'mood-happy')}>
          <Art srcs={stageArt(props.g.species, props.g.level)} emoji={speciesOf(props.g.species).emoji} alt={props.g.name} />
        </div>
      </div>

      <div className="rr-sol">🔥 {fl.call}</div>

      {passed('ready') && <div className="dc-line pop">🛡 {props.g.name} is ready for the journey!</div>}

      {passed('pack') && (
        <div className="dc-pack">
          <span className="dc-item pop" style={{ animationDelay: '0s' }}>🍎</span>
          <span className="dc-item pop" style={{ animationDelay: '0.15s' }}>🧭</span>
          <span className="dc-item pop" style={{ animationDelay: '0.3s' }}>💎</span>
        </div>
      )}

      {passed('depart') && <div className="dc-line pop">✨ Into {fl.scene} they go…</div>}
    </div>
  );
}

const RAID_MEMORIES = [
  'The Guardian crossed misty hills and found a hidden crystal cave.',
  'A friendly forest spirit guided the Guardian to ancient treasures.',
  'A gentle storm tested the Guardian\'s courage, but the journey was a success.',
  'The Guardian followed glowing fireflies to a secret grove.',
  'Beneath an old stone bridge, the Guardian discovered forgotten riches.',
  'The Guardian shared berries with a shy creature, who showed the way to treasure.',
  'Starlight lit the path as the Guardian explored a quiet valley.',
  'The Guardian climbed a mossy hill and found a chest left by kind travelers.',
  'A rainbow appeared after the rain, and the Guardian found gold at its end.',
  'The Guardian helped a lost cloud find its way, and was rewarded with wonders.',
];
const RAID_SOL_LINES = [
  'Your Guardian has returned from a great journey!',
  'A wonderful adventure has come to an end.',
  'Look! Your Guardian discovered something special.',
  'Your Guardian is home, and the satchel is full!',
  'What treasures has your brave Guardian found?',
];
function pickFrom(arr, seedStr) {
  // deterministic per-run so the same raid shows the same memory if reopened
  var h = 0; for (var i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return arr[h % arr.length];
}

function RaidReturn(props) {
  // props: g (guardian), def (dungeon def), result {gold,xp,drops}, leveledUp, itemsById, onClose
  var result = props.result || { gold: 0, xp: 0, drops: [] };
  var seed = (props.def ? props.def.id : 'raid') + '|' + result.gold + '|' + result.xp;
  // build the ordered reveal list: arrival -> sol -> gold -> xp -> each drop -> reaction -> memory
  var drops = (result.drops || []).map(function (d) {
    var it = props.itemsById ? props.itemsById[d.itemId] : null;
    return { name: it ? it.name : d.itemId, emoji: (it && it.emoji) ? it.emoji : '🎁', qty: d.qty };
  });
  // how "big" was the haul? drives the guardian's reaction mood
  var mood = (result.gold + result.xp) >= 80 ? 'great' : (props.def && props.def.tier === 'LONG') ? 'tired' : 'happy';
  var moodLine = mood === 'great' ? '🎉 ' + props.g.name + ' jumps for joy!' :
                 mood === 'tired' ? '😌 ' + props.g.name + ' is tired but proud.' :
                 '😊 ' + props.g.name + ' smiles proudly.';

  var STAGES = ['arrival', 'gold', 'xp'];
  drops.forEach(function (_, i) { STAGES.push('drop' + i); });
  STAGES.push('reaction', 'memory', 'done');

  var _a = useState(0); var stageIdx = _a[0]; var setStageIdx = _a[1];
  var stage = STAGES[stageIdx];

  // voice + auto-advance timing per stage (kid-paced, but the whole thing is skippable)
  useEffect(function () {
    if (stage === 'arrival') Voice.speak(pickFrom(RAID_SOL_LINES, seed));
    if (stage === 'gold' && result.gold) { Sfx.coin && Sfx.coin(); Voice.speak(props.g.name + ' brought home ' + result.gold + ' ancient coins for our island!'); }
    if (stage === 'xp' && result.xp) { Sfx.magic && Sfx.magic(); }
    if (stage && stage.indexOf('drop') === 0) { Sfx.chest && Sfx.chest(); }
    if (stage === 'reaction') { Sfx.victory && Sfx.victory(); Voice.speak('We are building our home together! Thank you!'); }
    if (stage === 'done') return; // wait for the button
    var dur = stage === 'arrival' ? 1900 : stage === 'memory' ? 2600 : 1300;
    var id = setTimeout(function () { setStageIdx(function (s) { return Math.min(s + 1, STAGES.length - 1); }); }, dur);
    return function () { clearTimeout(id); };
  }, [stageIdx]);

  function skip() { Voice.stop(); setStageIdx(STAGES.length - 1); }
  function done() { Voice.stop(); props.onClose(); }

  var passed = function (name) { return STAGES.indexOf(name) <= stageIdx; };

  return (
    <div className="raid-return">
      <button className="rr-skip" onClick={stage === 'done' ? done : skip}>{stage === 'done' ? 'Close' : 'Skip ›'}</button>

      {/* portal + returning guardian */}
      <div className="rr-portal">
        <div className="rr-portal-glow" />
        <div className={'rr-guardian mood-' + mood}>
          <Art srcs={stageArt(props.g.species, props.g.level)} emoji={speciesOf(props.g.species).emoji} alt={props.g.name} />
        </div>
      </div>

      <div className="rr-sol">🔥 {pickFrom(RAID_SOL_LINES, seed)}</div>

      {/* treasure reveal — one at a time */}
      <div className="rr-rewards">
        {passed('gold') && result.gold > 0 && (
          <div className="rr-reward pop" key="g"><span className="rr-r-ico">💰</span><span className="rr-r-txt">{props.g.name} brought home {result.gold} Ancient Coins!</span></div>
        )}
        {passed('xp') && result.xp > 0 && (
          <div className="rr-reward pop" key="x"><span className="rr-r-ico">⭐</span><span className="rr-r-txt">+{result.xp} Guardian XP — getting stronger!</span></div>
        )}
        {props.leveledUp && passed('xp') && (
          <div className="rr-reward pop levelup" key="lvl"><span className="rr-r-ico">🆙</span><span className="rr-r-txt">LEVEL UP!</span></div>
        )}
        {drops.map(function (d, i) {
          return passed('drop' + i) ? (
            <div className="rr-reward pop" key={'d' + i}><span className="rr-r-ico">{d.emoji}</span><span className="rr-r-txt">{d.name}{d.qty > 1 ? ' ×' + d.qty : ''} found!</span></div>
          ) : null;
        })}
      </div>

      {/* guardian reaction */}
      {passed('reaction') && <div className="rr-reaction">{moodLine}</div>}

      {/* adventure memory card */}
      {passed('memory') && (
        <div className="rr-memory">
          <div className="rr-memory-title">📖 Adventure Memory</div>
          <div className="rr-memory-text">{pickFrom(RAID_MEMORIES, seed)}</div>
        </div>
      )}

      {stage === 'done' && (
        <button className="sol-cta rr-done" onClick={done}>Return to the Hearth 🏡</button>
      )}
    </div>
  );
}

function RaidsScreen(props) {
  const state = props.state;
  const g = state.guardian;
  const [battle, setBattle] = useState(null);
  const [celebrate, setCelebrate] = useState(null); // {def, result, leveledUp} for the return party
  const [depart, setDepart] = useState(null); // {def, energyCost, phase:'preview'|'ceremony'} send-off
  const view = S.selectDungeonView(state);
  const active = view.find(function (d) { return d.isActive; });
  const run = S.selectActiveRun(state);
  const prog = (run && active && !active.claimable)
    ? Math.min(1, Math.max(0, 1 - active.remainingMs / Math.max(1, run.endsAt - run.startedAt)))
    : 1;
  const log = (run && active && g) ? raidLog(run, g.name) : [];
  const returned = !!(active && active.claimable);
  // Boosters the child holds — spent to hurry the current expedition home.
  const boosters = (state.inventory || [])
    .map(function (r) { return { row: r, item: state.itemsById[r.itemId] }; })
    .filter(function (b) { return b.item && b.item.type === 'BOOSTER' && b.row.qty > 0; });
  useEffect(function () { if (returned) Sfx.achieve(); }, [returned]);
  return (
    <React.Fragment>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Expeditions</h1>
      <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>
        Spend earned energy to send {g ? g.name : 'your guardian'} raiding. One expedition at a time.
        {S.selectGuardianPower(state) > 0 && <span className="gear-power inline"> · ★ {S.selectGuardianPower(state)} gear power</span>}
      </p>
      {active && run && g && (
        <div className="card hero">
          <div className="raid-live">
            <Art srcs={[active.def.id.replace('dgn_', 'dungeon-') + '.jpg']} emoji="🗺️" alt={active.def.name} />
            <div className={'pet-token ' + (active.claimable ? 'home' : 'march')}
              style={active.claimable ? null : { left: (6 + prog * 76) + '%' }}>
              {(function () {
                const rm = guardianMotion(g.species, g.level, active.claimable ? 'celebrate' : 'walk');
                return <AnimArt frames={rm.frames} fallback={rm.fallback} fps={rm.fps} fade={rm.fade} emoji={speciesOf(g.species).emoji} alt="" />;
              })()}
            </div>
            <div className="raid-head">
              <span className="display" style={{ fontSize: 17 }}>
                {active.claimable ? g.name + ' has returned!' : g.name + ' explores ' + active.def.name}
              </span>
              {!active.claimable && <span className="run-count">⏳ {fmtCountdown(active.remainingMs)}</span>}
            </div>
          </div>
          <div className="hero-body">
            {!active.claimable && (
              <React.Fragment>
                <div className="xp-bar"><span style={{ width: Math.round(prog * 100) + '%' }} /></div>
                <ul className="rlog">
                  {log.filter(function (e) { return e.at <= prog; }).map(function (e, i, arr) {
                    return <li key={i} className={i === arr.length - 1 ? 'new' : ''}>{e.text}</li>;
                  })}
                  {log.filter(function (e) { return e.at <= prog; }).length === 0 && (
                    <li className="new">{g.name} sets off into {active.def.name}… 🏕️</li>
                  )}
                </ul>
                {boosters.length > 0 && (
                  <div className="booster-bar">
                    <span className="booster-label">✨ Speed up</span>
                    {boosters.map(function (b) {
                      return (
                        <button key={b.item.id} className="mini booster"
                          title={b.item.description}
                          onClick={function () { props.store.dispatch(A.useBooster(active.runId, b.item.id)); }}>
                          {b.item.name} ×{b.row.qty}
                        </button>
                      );
                    })}
                  </div>
                )}
              </React.Fragment>
            )}
            {active.claimable && (
              <React.Fragment>
                <p className="note" style={{ margin: '0 0 10px' }}>The satchel is heavy with treasure…</p>
                <button className={"btn primary pulse" + (props.guide === "raid-claim" ? " guide-glow" : "")} style={{ width: '100%' }}
                  onClick={function () { setBattle({ def: active.def, runId: active.runId }); }}>
                  ⚔️ Fight for the haul!
                </button>
              </React.Fragment>
            )}
          </div>
        </div>
      )}
      {view.map(function (d) {
        const artName = d.def.id.replace('dgn_', 'dungeon-') + '.jpg';
        const canStart = d.unlocked && !d.blocked && !d.isActive && g && g.energy >= d.energyCost;
        return (
          <div className="d-card" key={d.def.id}>
            <div className="d-art">
              <Art srcs={[artName]} emoji="🗺️" alt={d.def.name} />
              <div className="d-body">
                <div>
                  <div className="d-name">{d.def.name}</div>
                  <div className="d-meta">{d.def.durationMin} min · {d.energyCost}⚡ {d.isActive ? '· out now' : ''}</div>
                </div>
                {!d.isActive && d.unlocked && !d.blocked && (
                  <button className="mini go" disabled={!canStart}
                    onClick={function () { if (canStart) setDepart({ def: d.def, energyCost: d.energyCost, phase: 'preview' }); }}>
                    {g && g.energy < d.energyCost ? 'Need ' + d.energyCost + '⚡' : 'Set out'}
                  </button>
                )}
                {d.blocked && !d.isActive && <span className="d-meta">expedition out</span>}
              </div>
              {!d.unlocked && <div className="d-lock">🔒 Unlocks at level {d.def.unlockLevel}</div>}
            </div>
          </div>
        );
      })}
      {battle && run && g && (
        <BattleOverlay store={props.store} g={g} def={battle.def} run={run} runId={battle.runId}
          onClose={function (r) {
            var def = battle.def;
            setBattle(null);
            if (r && r.result) setCelebrate({ def: def, result: r.result, leveledUp: !!r.leveledUp });
          }} />
      )}
      {celebrate && g && (
        <RaidReturn g={g} def={celebrate.def} result={celebrate.result} leveledUp={celebrate.leveledUp}
          itemsById={state.itemsById} onClose={function () { setCelebrate(null); }} />
      )}
      {depart && depart.phase === 'preview' && g && (
        <DeparturePreview def={depart.def} energyCost={depart.energyCost}
          onCancel={function () { setDepart(null); }}
          onBegin={function () { setDepart({ def: depart.def, energyCost: depart.energyCost, phase: 'ceremony' }); }} />
      )}
      {depart && depart.phase === 'ceremony' && g && (
        <DepartureCeremony g={g} def={depart.def}
          onComplete={async function () {
            var defId = depart.def.id;
            setDepart(null);
            var r = await props.store.dispatch(A.startDungeon(defId));
            if (r && r.ok) Sfx.raid();
          }} />
      )}
    </React.Fragment>
  );
}

/* ---------------- island ---------------- */
const BUILDING_LORE = {
  HOME: 'Where the hearth burns warmest. Every level makes home cozier.',
  GARDEN: 'Glowing herbs and shy mushrooms. Tend it and it blooms brighter.',
  WORKSHOP: 'Anvils, tools, and big ideas take shape by the forge.',
  HARBOR: 'Little boats bring news and treasures from far waters.',
  RUINS: 'Old stones humming with forgotten rune-magic.',
  SANCTUARY: "Your guardian's nest among the branches. Each level adds +10⚡ to the energy cap.",
};

const PLOTS = [
  { type: 'HOME', x: 49, y: 27.5, w: 30 },
  { type: 'GARDEN', x: 26, y: 35.5, w: 25 },
  { type: 'WORKSHOP', x: 72, y: 35.5, w: 25 },
  { type: 'HARBOR', x: 26, y: 61, w: 25 },
  { type: 'RUINS', x: 73, y: 61, w: 25 },
  { type: 'SANCTUARY', x: 49, y: 70.5, w: 26 },
];
// Re-render the world on a gentle tick so the sky shifts with real time.
function useWorldClock(everyMs) {
  const [, setN] = useState(0);
  useEffect(function () {
    const id = setInterval(function () { setN(function (x) { return x + 1; }); }, everyMs || 60000);
    return function () { clearInterval(id); };
  }, []);
}
// A deterministic starfield (positions fixed so stars don't jump between renders).
const STARS = (function () {
  const rng = G.RNG.mulberry32(20260613);
  const out = [];
  for (let i = 0; i < 26; i++) {
    out.push({
      left: (rng() * 100).toFixed(2) + '%',
      top: (rng() * 46).toFixed(2) + '%',
      size: (1 + rng() * 1.6).toFixed(2),
      delay: (rng() * 3).toFixed(2),
    });
  }
  return out;
})();

const FIREFLIES = (function () {
  const arr = [];
  const spots = [[16, 22], [82, 18], [12, 52], [86, 48], [22, 78], [78, 80], [50, 44], [60, 12]];
  for (let i = 0; i < spots.length; i++) {
    arr.push(
      <span key={i} className="ffly" style={{
        left: spots[i][0] + '%', top: spots[i][1] + '%',
        animationDuration: (2.6 + (i % 4) * 0.9) + 's',
        animationDelay: (i * 0.45) + 's',
      }} />
    );
  }
  return arr;
})();

function PlotBuilding(props) {
  const [cutFail, setCutFail] = useState(false);
  const p = props.plot;
  return (
    <button className={'plot' + (props.built ? ' built' : '')}
      style={{ left: p.x + '%', top: p.y + '%', width: p.w + '%' }}
      onClick={props.onOpen}>
      {!cutFail ? (
        <img className="cut" src={'./building-' + p.type.toLowerCase() + '-cut.png'}
          alt={props.name} onError={function () { setCutFail(true); }} />
      ) : (
        <span className="tok">
          <Art srcs={['building-' + p.type.toLowerCase() + '.jpg']} emoji="🏗️" alt={props.name} />
        </span>
      )}
      {props.windows > 0 && <span className="win-glow" style={{ opacity: props.windows, transition: 'opacity 1.5s ease' }} />}
      <span className="plot-tag">{props.name} · Lv {props.level}</span>
    </button>
  );
}

function IslandScreen(props) {
  useWorldClock(60000);
  const state = props.state;
  const fd = S.selectFlame(state);
  const FV = G.CONFIG.FLAME.VISUALS;
  const tod = S.selectTimeOfDay();
  const g = state.guardian;
  const child = S.selectActiveChild(state);
  const [openType, setOpenType] = useState(null);
  const [built, setBuilt] = useState(null);
  const [bgFail, setBgFail] = useState(false);
  const [heroFail, setHeroFail] = useState(false);
  var openRaw = openType ? state.buildings.find(function (b) { return b.type === openType; }) : null;
  var open = openRaw ? Object.assign({}, openRaw, {
    maxLevel: G.CONFIG.BUILDINGS[openRaw.type] ? G.CONFIG.BUILDINGS[openRaw.type].maxLevel : openRaw.level,
    nextCost: (function () { var d = G.CONFIG.BUILDINGS[openRaw.type]; return (d && openRaw.level < d.maxLevel) ? Math.round(d.baseCost * Math.pow(G.CONFIG.ECONOMY.BUILDING_COST_GROWTH, openRaw.level)) : null; })(),
  }) : null;
  const byType = {};
  state.buildings.forEach(function (b) { byType[b.type] = b; });
  async function upgrade(type) {
    const r = await props.store.dispatch(A.upgradeBuilding(type));
    if (r.ok) {
      Sfx.build();
      setBuilt(type);
      setTimeout(function () { setBuilt(null); }, 950);
    }
  }
  // GOTH 1.1: compute the coin cost + whether the child has everything to build the next level
  function nextCostFor(b) {
    var def = G.CONFIG.BUILDINGS[b.type];
    if (!def || b.level >= def.maxLevel) return null;
    return Math.round(def.baseCost * Math.pow(G.CONFIG.ECONOMY.BUILDING_COST_GROWTH, b.level));
  }
  function invCountOf(itemId) {
    var row = (state.inventory || []).find(function (r) { return r.itemId === itemId; });
    return row ? row.qty : 0;
  }
  function canBuild(b) {
    if (!b || b.level >= b.maxLevel) return false;
    var cost = nextCostFor(b);
    if (!g || g.gold < cost) return false;
    var need = G.Building.materialCostFor(b.type, b.level);
    return need.every(function (m) { return invCountOf(m.itemId) >= m.qty; });
  }
  function pipsFor(b) {
    const arr = [];
    for (let i = 0; i < b.maxLevel; i++) arr.push(<span key={i} className={'pip' + (i < b.level ? ' on' : '')} />);
    return <div className="pips">{arr}</div>;
  }
  return (
    <React.Fragment>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>Hearth Island</h1>
      <p className="note" style={{ marginTop: 0, marginBottom: 10 }}>Use your treasures to make your island more beautiful. Tap a building to grow it.</p>
      <a className="explore-btn" href="./island-overworld.html" target="_blank" rel="noopener">
        <span className="explore-emoji">🕹️</span>
        <span>
          <span className="explore-title">Explore Island Mode</span>
          <span className="explore-sub">Walk around with your guardian (beta)</span>
        </span>
        <span className="explore-arrow">›</span>
      </a>
      <div className="card">
        <div className="b-row" style={{ borderBottom: 'none', padding: 0 }}>
          <div className="b-thumb" style={{ width: 70, height: 70 }}><Art srcs={['chest.jpg']} emoji="📦" alt="Loot crate" /></div>
          <div className="b-main">
            <div style={{ fontWeight: 600 }}>Mystery Loot Crates</div>
            <div className="note" style={{ margin: 0 }}>{state.crates} waiting to be opened</div>
          </div>
          <button className={"mini go" + (props.guide === "crate-open" ? " guide-glow" : "")} disabled={state.crates === 0}
            onClick={function () { props.store.dispatch(A.openCrate()); }}>
            Open one
          </button>
        </div>
      </div>
      <div className={'island-scene tod-' + tod.id}>
        {!bgFail && <img className="base" src="./bg-island.jpg" alt=""
          style={{ filter: 'saturate(' + (FV.WARMTH[fd.stage] * tod.light.sat) + ') brightness(' + (FV.BRIGHT[fd.stage] * tod.light.bright) + ')',
            transition: 'filter ' + (G.CONFIG.DAYNIGHT.CROSSFADE_MS) + 'ms ease' }}
          onError={function () { setBgFail(true); }} />}
        <div className="sky-veil" style={{
          background: 'linear-gradient(180deg, ' + tod.sky[0] + ' 0%, ' + tod.sky[1] + ' 45%, ' + tod.sky[2] + ' 100%)',
          transition: 'background ' + G.CONFIG.DAYNIGHT.CROSSFADE_MS + 'ms ease' }} />
        {tod.stars > 0 && (
          <div className="starfield" style={{ opacity: tod.stars, transition: 'opacity 1.5s ease' }}>
            {STARS.map(function (s, i) {
              return <span key={i} className="star" style={{ left: s.left, top: s.top,
                width: s.size + 'px', height: s.size + 'px', animationDelay: s.delay + 's' }} />;
            })}
          </div>
        )}
        <span className={'celestial ' + (tod.isNight ? 'moon' : 'sun')}
          style={{ left: (8 + tod.arc * 84) + '%', top: (62 - Math.sin(tod.arc * Math.PI) * 50) + '%',
            opacity: (tod.id === 'day' || tod.isNight) ? 1 : 0.85 }} />
        {FIREFLIES.slice(0, FV.FIREFLIES[fd.stage])}
        <span className="puff" style={{ left: '51.5%', top: '19%' }} />
        <span className="puff" style={{ left: '52.5%', top: '19.5%', animationDelay: '1.3s' }} />
        <span className="puff" style={{ left: '50.8%', top: '20%', animationDelay: '2.6s' }} />
        <span className="island-shrine" style={{ left: '48.5%', top: '47.5%',
          width: (FV.SHRINE_PX[fd.stage] * (0.85 + tod.hearthGlow * 0.5)) + 'px',
          height: (FV.SHRINE_PX[fd.stage] * (0.85 + tod.hearthGlow * 0.5)) + 'px',
          boxShadow: '0 0 ' + Math.round(FV.SHRINE_GLOW[fd.stage] * (0.6 + tod.hearthGlow)) + 'px '
            + Math.round(FV.SHRINE_GLOW[fd.stage] * (0.4 + tod.hearthGlow * 0.6)) + 'px rgba(255,150,60,'
            + (0.5 + tod.hearthGlow * 0.4) + ')',
          transition: 'all ' + G.CONFIG.DAYNIGHT.CROSSFADE_MS + 'ms ease' }} />
        <div className="hearth-halo" style={{ left: '48.5%', top: '47.5%',
          width: (120 + tod.hearthGlow * 120) + 'px', height: (120 + tod.hearthGlow * 120) + 'px',
          opacity: 0.18 + tod.hearthGlow * 0.5,
          transition: 'all ' + G.CONFIG.DAYNIGHT.CROSSFADE_MS + 'ms ease' }} />
        {PLOTS.map(function (p) {
          const b = byType[p.type];
          if (!b) return null;
          return (
            <PlotBuilding key={p.type} plot={p} name={b.name} level={b.level}
              built={built === p.type} windows={tod.windows}
              onOpen={function () { setOpenType(p.type); }} />
          );
        })}
        <div className="hero-duo" style={{ left: '42%', top: '51%', width: '15%' }}>
          {!heroFail ? (
            <img className="cut" src="./hero-1.png" alt={child ? child.name : 'Hero'}
              onError={function () { setHeroFail(true); }} />
          ) : (
            <span style={{ fontSize: 34, display: 'block', textAlign: 'center' }}>{child ? child.avatar : '🧒'}</span>
          )}
        </div>
        {g && (function () {
          const im = guardianMotion(g.species, g.level, 'idle');
          return (
            <span className={'duo-pet ' + im.cls} style={{ left: '53%', top: '49.5%' }}>
              <AnimArt frames={im.frames} fallback={im.fallback} fps={im.fps} fade={im.fade} emoji={speciesOf(g.species).emoji} alt={g.name} />
            </span>
          );
        })()}
      </div>
      {open && (
        <div className="veil" onClick={function () { setOpenType(null); }}>
          <div className="sheet" onClick={function (e) { e.stopPropagation(); }}>
            <div className={'isl-hero' + (built === open.type ? ' isl-card built' : '')}>
              <Art srcs={['building-' + open.type.toLowerCase() + '.jpg']} emoji="🏗️" alt={open.name} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h2>{open.name}</h2>
              <span className="lv-pill">Lv {open.level}/{open.maxLevel}</span>
            </div>
            {pipsFor(open)}
            {open.level < open.maxLevel && (function () {
              var need = G.Building.materialCostFor(open.type, open.level);
              var invCount = function (itemId) {
                var row = (state.inventory || []).find(function (r) { return r.itemId === itemId; });
                return row ? row.qty : 0;
              };
              var allEnough = need.every(function (m) { return invCount(m.itemId) >= m.qty; }) && g && g.gold >= open.nextCost;
              return (
                <div className="mat-req">
                  <div className="mat-req-title">To grow this, you need:</div>
                  {need.map(function (m) {
                    var have = invCount(m.itemId);
                    var item = state.itemsById[m.itemId];
                    var ok = have >= m.qty;
                    return (
                      <div key={m.itemId} className={'mat-row' + (ok ? ' ok' : ' short')}>
                        <span className="mat-ico">{ITEM_EMOJI[m.itemId] || '📦'}</span>
                        <span className="mat-name">{item ? item.name : m.itemId}</span>
                        <span className="mat-count">{have} / {m.qty}{ok ? ' ✓' : ''}</span>
                      </div>
                    );
                  })}
                  <div className={'mat-row' + (g && g.gold >= open.nextCost ? ' ok' : ' short')}>
                    <span className="mat-ico">✦</span>
                    <span className="mat-name">Coins</span>
                    <span className="mat-count">{g ? g.gold : 0} / {open.nextCost}{g && g.gold >= open.nextCost ? ' ✓' : ''}</span>
                  </div>
                  {!allEnough && (
                    <div className="mat-nudge" onClick={function () { setOpenType(null); props.setTab && props.setTab('raids'); }}>
                      🗺️ {g ? g.name : 'Your guardian'} can find these on an adventure! Tap to go on a Raid.
                    </div>
                  )}
                </div>
              );
            })()}
            <div className="btnrow" style={{ marginTop: 12 }}>
              <button className="btn" onClick={function () { setOpenType(null); }}>Close</button>
              {open.nextCost !== null ? (
                <button className="btn primary" disabled={!canBuild(open)}
                  onClick={function () { upgrade(open.type); }}>
                  {canBuild(open) ? 'Build it! 🔨' : 'Need more materials'}
                </button>
              ) : (
                <span className="seal" style={{ alignSelf: 'center' }}>Fully grown ✨</span>
              )}
            </div>
            <p className="note">{BUILDING_LORE[open.type]}</p>
          </div>
        </div>
      )}
    </React.Fragment>
  );
}

/* ---------------- bag ---------------- */
function TreasureCell(props) {
  const r = props.r;
  const rar = r.item ? r.item.rarity : 'COMMON';
  const rank = RARITY_RANK[rar] || 0;
  const [pop, setPop] = useState(false);
  function tap() {
    if (rank >= 2) Sfx.sparkle(); else Sfx.coin();
    Voice.say((r.item ? r.item.name : 'treasure') + '. ' + RARITY_LABEL[rar]);
    setPop(true);
    setTimeout(function () { setPop(false); }, 650);
  }
  return (
    <button className={'treasure r-' + rar.toLowerCase() + (pop ? ' pop' : '')} onClick={tap}>
      <span className="t-gem">
        <span className="t-emoji">{itemEmoji(r.itemId)}</span>
        {rank >= 2 && <span className="t-spark s1">✨</span>}
        {rank >= 3 && <span className="t-spark s2">⭐</span>}
        {rank >= 4 && <span className="t-spark s3">💫</span>}
      </span>
      <span className="t-name">{r.item ? r.item.name : r.itemId}</span>
      {r.qty > 1 && <span className="t-qty">{r.qty}</span>}
    </button>
  );
}

function BagScreen(props) {
  const state = props.state;
  const inv = S.selectInventoryDetailed(state).filter(function (r) { return r.qty > 0; });
  const sorted = inv.slice().sort(function (a, b) {
    const ra = RARITY_RANK[a.item ? a.item.rarity : 'COMMON'] || 0;
    const rb = RARITY_RANK[b.item ? b.item.rarity : 'COMMON'] || 0;
    return rb - ra;
  });
  const totalKinds = inv.length;
  const totalCount = inv.reduce(function (s, r) { return s + r.qty; }, 0);
  const best = sorted.length ? (sorted[0].item ? sorted[0].item.rarity : 'COMMON') : null;
  // Guardian gear: owned equipment the child can wear into expeditions.
  const g = state.guardian;
  const equipped = S.selectEquipped(state);
  const power = S.selectGuardianPower(state);
  const gearOwned = sorted.filter(function (r) { return r.item && r.item.type === 'EQUIPMENT'; });
  const slotsFull = equipped.length >= G.CONFIG.EQUIP.MAX_SLOTS;
  return (
    <React.Fragment>
      <div className="bag-head">
        <h1 style={{ fontSize: 26, margin: 0 }}>🎒 My Treasures</h1>
        {totalKinds > 0 && (
          <span className="bag-count">{totalCount} {totalCount === 1 ? 'treasure' : 'treasures'}</span>
        )}
      </div>
      <div className="card bag-shelf">
        {inv.length === 0 && (
          <div className="bag-empty">
            <div className="bag-empty-icon">🗝️</div>
            <p className="note" style={{ margin: 0 }}>Your treasure chest is waiting!</p>
            <p className="note" style={{ margin: '4px 0 0', fontSize: 13 }}>Send your guardian on a raid to find shiny things.</p>
          </div>
        )}
        {inv.length > 0 && (
          <React.Fragment>
            {best && (RARITY_RANK[best] >= 3) && (
              <div className="bag-brag">Wow! You found something {RARITY_LABEL[best].replace(/!+/g, '')}!</div>
            )}
            <div className="treasure-grid">
              {sorted.map(function (r) { return <TreasureCell key={r.itemId} r={r} />; })}
            </div>
          </React.Fragment>
        )}
      </div>
      {g && (gearOwned.length > 0 || equipped.length > 0) && (
        <div className="card gear-card">
          <div className="gear-head">
            <h2 style={{ margin: 0 }}>🛡️ {g.name}'s Gear</h2>
            <span className="gear-power">★ {power} power</span>
          </div>
          <p className="note" style={{ margin: '4px 0 10px' }}>
            Wear up to {G.CONFIG.EQUIP.MAX_SLOTS} pieces — more power means richer expedition hauls.
          </p>
          {gearOwned.length === 0 && (
            <p className="note" style={{ margin: 0, fontSize: 13 }}>Find armor and weapons on raids, then come back to equip them.</p>
          )}
          <div className="gear-list">
            {gearOwned.map(function (r) {
              const on = equipped.indexOf(r.itemId) !== -1;
              return (
                <div className={'gear-row' + (on ? ' on' : '')} key={r.itemId}>
                  <span className="gear-name">{r.item.name}</span>
                  <span className="gear-pw">+{G.Gear.itemPower(r.item)}</span>
                  {on
                    ? <button className="mini" onClick={function () { props.store.dispatch(A.unequipGear(r.itemId)); }}>Worn ✓</button>
                    : <button className="mini go" disabled={slotsFull}
                        onClick={function () { props.store.dispatch(A.equipGear(r.itemId)); }}>
                        {slotsFull ? 'Slots full' : 'Equip'}
                      </button>}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <div className="card">
        <h2>Achievements</h2>
        {state.achievements.map(function (a) {
          const pct = Math.min(100, Math.round((a.progress / a.target) * 100));
          return (
            <div className="ach-row" key={a.def.id}>
              <div className="ach-top">
                <span>{a.unlockedAt !== undefined ? '🏅 ' : ''}{a.def.name}</span>
                <span className="num" style={{ color: 'var(--dim)' }}>{a.progress}/{a.target}</span>
              </div>
              <div className="bar"><span style={{ width: pct + '%' }} /></div>
            </div>
          );
        })}
      </div>
    </React.Fragment>
  );
}

/* ---------------- gate modal ---------------- */
function GateModal(props) {
  const state = props.state;
  const store = props.store;
  const parent = S.selectParent(state);
  const [name, setName] = useState('Keeper');
  const [pin, setPin] = useState('');
  async function go(action) {
    const r = await store.dispatch(action);
    if (r.ok) { setPin(''); Sfx.gate(); }
  }
  return (
    <div className="veil center" onClick={function () { store.dispatch(A.hideGate()); }}>
      <div className="modal" onClick={function (e) { e.stopPropagation(); }}>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Keeper's gate</div>
        <h2 style={{ marginBottom: 8 }}>Parents only 🛡️</h2>
        {!parent && (
          <React.Fragment>
            <p className="note" style={{ marginTop: 0 }}>Create the parent account and choose a PIN (4–12 digits).</p>
            <input className="field" value={name} maxLength={24} placeholder="Parent name"
              onChange={function (e) { setName(e.target.value); }} />
            <input className="field" type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={12}
              placeholder="Choose a PIN" onChange={function (e) { setPin(e.target.value); }} />
            <div className="btnrow">
              <button className="btn" onClick={function () { store.dispatch(A.hideGate()); }}>Cancel</button>
              <button className="btn primary" onClick={function () { go(A.setupParent(name, pin)); }}>Create &amp; set PIN</button>
            </div>
          </React.Fragment>
        )}
        {parent && !state.parentHasPin && (
          <React.Fragment>
            <p className="note" style={{ marginTop: 0 }}>{parent.name} has no PIN yet. Choose one (4–12 digits).</p>
            <input className="field" type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={12}
              placeholder="Choose a PIN" onChange={function (e) { setPin(e.target.value); }} />
            <div className="btnrow">
              <button className="btn" onClick={function () { store.dispatch(A.hideGate()); }}>Cancel</button>
              <button className="btn primary" onClick={function () { go(A.setupPin(pin)); }}>Set PIN</button>
            </div>
          </React.Fragment>
        )}
        {parent && state.parentHasPin && (
          <React.Fragment>
            <p className="note" style={{ marginTop: 0 }}>Enter the Keeper's PIN. Three wrong tries lock the gate.</p>
            <input className="field" type="password" inputMode="numeric" autoComplete="off" value={pin} maxLength={12}
              placeholder="PIN" onChange={function (e) { setPin(e.target.value); }} />
            <div className="btnrow">
              <button className="btn" onClick={function () { store.dispatch(A.hideGate()); }}>Cancel</button>
              <button className="btn primary" onClick={function () { go(A.unlock(pin)); }}>Unlock</button>
            </div>
          </React.Fragment>
        )}
        {state.ui.gateToast && (
          <div className={'toast ' + (state.ui.gateToast.kind === 'ok' ? 'ok' : 'bad')}
            style={{ position: 'static', marginTop: 12 }}>
            {state.ui.gateToast.text}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------- celebrations ---------------- */
function FlameAutoDismiss(props) {
  useEffect(function () {
    const ms = G.CONFIG.FLAME.CELEBRATION.AUTO_DISMISS_MS;
    if (!ms) return;
    const id = setTimeout(props.onDone, ms);
    return function () { clearTimeout(id); };
  }, []);
  return null;
}

// ===== W3.0 LEGENDARY CRATE REVEAL — dramatizes the EXISTING crate open by rarity =====
// Uses the existing rarity on the opened item. No new systems, no new rewards.
const CRATE_TIER = {
  COMMON:    { tier: 0, glow: '#cfd6e6', sol: 'Your guardian found something useful!', label: 'A useful find' },
  UNCOMMON:  { tier: 0, glow: '#7ed08a', sol: 'Oh! A nice little treasure!', label: 'A nice treasure' },
  RARE:      { tier: 1, glow: '#5fa8ff', sol: 'Wait\u2026 this energy feels unusual!', label: 'Something rare!' },
  EPIC:      { tier: 1, glow: '#b07eff', sol: 'Incredible! Such power inside!', label: 'An epic discovery!' },
  LEGENDARY: { tier: 2, glow: '#ffb13d', sol: 'An ancient treasure has awakened!', label: 'LEGENDARY!' },
  MYTHIC:    { tier: 2, glow: '#ff5fd0', sol: 'A myth made real\u2026 I have never seen such a thing!', label: 'MYTHIC!' },
};

function CrateReveal(props) {
  // props: item, rarity, onClose
  var info = CRATE_TIER[props.rarity] || CRATE_TIER.COMMON;
  var tier = info.tier; // 0 quick, 1 dramatic, 2 cinematic
  // phases: 'build' (chest shakes/glows, Sol speaks) -> 'open' (tap revealed) -> 'reward'
  var _p = useState(tier >= 1 ? 'build' : 'reward'); var phase = _p[0]; var setPhase = _p[1];

  useEffect(function () {
    if (phase === 'build') {
      Voice.speak(info.sol);
      if (tier >= 2) { Sfx.flame && Sfx.flame(); } else { Sfx.magic && Sfx.magic(); }
    }
    if (phase === 'reward') {
      if (tier >= 2) { Sfx.achieve && Sfx.achieve(); } else if (tier >= 1) { Sfx.chest && Sfx.chest(); } else { Sfx.sparkle && Sfx.sparkle(); }
    }
  }, [phase]);

  function openIt() { Sfx.chest && Sfx.chest(); setPhase('reward'); }
  function done() { Voice.stop(); props.onClose(); }

  var emoji = (props.item && ITEM_EMOJI[props.item.id]) ? ITEM_EMOJI[props.item.id] : '🎁';

  return (
    <div className={'crate-reveal tier-' + tier} onClick={phase === 'reward' ? done : null}>
      {tier >= 2 && <div className="crate-dark" />}
      {phase === 'build' && (
        <div className="crate-stage" onClick={function (e) { e.stopPropagation(); openIt(); }}>
          <div className="crate-glow" style={{ background: 'radial-gradient(circle, ' + info.glow + '88, transparent 70%)' }} />
          <div className="crate-box shaking" style={{ filter: 'drop-shadow(0 0 14px ' + info.glow + ')' }}>
            <Art srcs={['chest.jpg']} emoji="📦" alt="Treasure" />
            {tier >= 1 && <div className="crate-cracks" style={{ color: info.glow }}>✦</div>}
          </div>
          <div className="crate-sol">🔥 {info.sol}</div>
          <button className="sol-cta crate-tap" onClick={function (e) { e.stopPropagation(); openIt(); }}>Tap to open! ✨</button>
        </div>
      )}
      {phase === 'reward' && (
        <div className="crate-stage" onClick={function (e) { e.stopPropagation(); }}>
          <div className="crate-glow big" style={{ background: 'radial-gradient(circle, ' + info.glow + 'aa, transparent 72%)' }} />
          <div className="crate-reward-emoji" style={{ filter: 'drop-shadow(0 0 18px ' + info.glow + ')' }}>{emoji}</div>
          <div className="crate-rar" style={{ color: info.glow }}>{info.label}</div>
          <div className="crate-item-name">{props.item ? props.item.name : 'Treasure'}</div>
          {tier >= 2 && <div className="crate-burst">✨🎉✨</div>}
          <button className="sol-cta" style={{ marginTop: 14 }} onClick={done}>Wonderful! 🌟</button>
        </div>
      )}
    </div>
  );
}

function Celebration(props) {
  const c = props.state.ui.celebration;
  const store = props.store;
  function close() { store.dispatch(A.clearCelebration()); }
  // W3.0: crate opens get the dramatic, rarity-scaled reveal.
  if (c.type === 'crate') {
    return <CrateReveal item={c.item} rarity={c.rarity} onClose={close} />;
  }
  const sayText = c.type === 'levelUp' ? 'Level up! Level ' + c.level + '!'
    : c.type === 'flame' ? 'The flame grows! ' + c.name + '!'
    : c.type === 'achievement' ? 'Achievement! ' + (c.name || '') : '';
  return (
    <div className="celebrate" onClick={close}>
      <div className="cele-card" onClick={function (e) { e.stopPropagation(); }}>
        {sayText ? <Say key={sayText} text={sayText} /> : null}
        {c.type === 'levelUp' && (
          <React.Fragment>
            <div className="burst">🎉</div>
            <h2 className="display" style={{ fontSize: 30, margin: '6px 0' }}>Level {c.level}!</h2>
            <p className="note" style={{ marginTop: 0 }}>Your guardian grows stronger.</p>
          </React.Fragment>
        )}
        {c.type === 'flame' && (
          <React.Fragment>
            <FlameAutoDismiss onDone={close} />
            <div className="cele-flame">🔥</div>
            <h2 className="display" style={{ fontSize: 24, margin: '6px 0' }}>The Flame grows!</h2>
            <p style={{ margin: '2px 0', fontWeight: 700, color: 'var(--gold)', fontSize: 18 }}>{c.name}</p>
            <p className="note" style={{ marginTop: 4 }}>Your family's light grows brighter.</p>
          </React.Fragment>
        )}
        {c.type === 'keeper' && (
          <React.Fragment>
            <div className="keeper-ring big" style={{ margin: '0 auto', boxShadow: '0 0 0 4px ' + c.aura + ', 0 0 32px ' + c.aura }}>
              <Art srcs={c.art ? [c.art] : []} emoji={c.emoji || '🧒'} alt={c.name} />
            </div>
            <h2 className="display" style={{ fontSize: 26, margin: '10px 0 2px', color: c.aura }}>{c.name}!</h2>
            <p className="note" style={{ marginTop: 0 }}>Your hero evolved — {c.title}.</p>
          </React.Fragment>
        )}
        {c.type === 'achievement' && (
          <React.Fragment>
            <div className="burst">🏅</div>
            <h2 style={{ margin: '6px 0' }}>Achievement unlocked</h2>
            {c.defs.map(function (d) {
              return <p key={d.id} style={{ margin: '4px 0', fontWeight: 600 }}>{d.name}</p>;
            })}
          </React.Fragment>
        )}
        {(c.type === 'loot' || c.type === 'crate') && (
          <React.Fragment>
            <div className="chest-wrap"><Art srcs={['chest-open.jpg']} emoji="✨" alt="Open chest" /></div>
            <h2 style={{ margin: '4px 0 8px' }}>{c.type === 'crate' ? 'Crate opened!' : 'Expedition haul'}</h2>
            {c.type === 'loot' && (
              <React.Fragment>
                <div className="drop-row"><span>Gold</span><b className="num" style={{ color: 'var(--gold)' }}>+{c.result.gold} ✦</b></div>
                <div className="drop-row"><span>Experience</span><b className="num">+{c.result.xp} xp</b></div>
                {c.result.drops.map(function (d) {
                  const item = props.state.itemsById[d.itemId];
                  const rar = item ? item.rarity : 'COMMON';
                  return (
                    <div className="drop-row" key={d.itemId}>
                      <span><span style={{ color: RARITY_COLOR[rar] }}>◆</span> {item ? item.name : d.itemId} ×{d.qty}</span>
                      <span className="rar" style={{ color: RARITY_COLOR[rar] }}>{rar}</span>
                    </div>
                  );
                })}
              </React.Fragment>
            )}
            {c.type === 'crate' && (
              <div className="drop-row">
                <span><span style={{ color: RARITY_COLOR[c.rarity] }}>◆</span> {c.item.name}</span>
                <span className="rar" style={{ color: RARITY_COLOR[c.rarity] }}>{c.rarity}</span>
              </div>
            )}
          </React.Fragment>
        )}
        <button className="btn primary" style={{ width: '100%', marginTop: 14 }} onClick={close}>Wonderful!</button>
      </div>
    </div>
  );
}

/* ---------------- parent ledger ---------------- */
function ParentShell(props) {
  const state = props.state;
  const store = props.store;
  const [ptab, setPtab] = useState('queue');
  useEffect(function () { store.dispatch(A.loadParentOverview()); Music.setScene('hearth'); }, []);
  useEffect(function () {
    if (!state.ui.toast) return;
    const id = setTimeout(function () { store.dispatch(A.clearToast('main')); }, 3600);
    return function () { clearTimeout(id); };
  }, [state.ui.toast]);
  useEffect(function () {
    if (!state.ui.gateToast) return;
    const id = setTimeout(function () { store.dispatch(A.clearToast('gate')); }, 4500);
    return function () { clearTimeout(id); };
  }, [state.ui.gateToast]);
  const left = S.selectSessionRemainingMs(state);
  const chain = state.chain;
  return (
    <React.Fragment>
      <div className="ledger-bg" />
      <div className="shell">
        <header className="hdr">
          <div className="hdr-title"><span style={{ fontSize: 18 }}>📜</span> Keeper's Ledger</div>
          <button className="hdr-kid" onClick={function () { store.dispatch(A.lock()); }}>🔒 Lock</button>
        </header>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="seal num">session {fmtCountdown(left)}</span>
          {chain && <span className={'seal' + (chain.valid ? '' : ' bad')}>{chain.valid ? 'chain VALID · ' + chain.length : 'chain ' + chain.reason}</span>}
        </div>
        <div className="p-tabs">
          <button className={'p-tab' + (ptab === 'queue' ? ' on' : '')} onClick={function () { setPtab('queue'); }}>
            Approvals{state.parentQueue.length > 0 ? ' (' + state.parentQueue.length + ')' : ''}
          </button>
          <button className={'p-tab' + (ptab === 'family' ? ' on' : '')} onClick={function () { setPtab('family'); }}>Family</button>
          <button className={'p-tab' + (ptab === 'settings' ? ' on' : '')} onClick={function () { setPtab('settings'); }}>Settings</button>
        </div>
        <main className="shell-main" style={{ paddingBottom: 30 }}>
          {ptab === 'queue' && <ParentQueue store={store} state={state} />}
          {ptab === 'family' && <ParentFamily store={store} state={state} />}
          {ptab === 'settings' && <ParentSettings store={store} state={state} storeCtx={props.storeCtx} />}
        </main>
      </div>
      {state.ui.toast && <div className={'toast ' + (state.ui.toast.kind === 'ok' ? 'ok' : 'bad')} style={{ bottom: 18 }}>{state.ui.toast.text}</div>}
    </React.Fragment>
  );
}

function ParentQueue(props) {
  const q = props.state.parentQueue;
  if (q.length === 0) {
    return <div className="card"><h2>All caught up</h2><p className="note" style={{ marginTop: 0 }}>No quests are waiting. New submissions from any child appear here.</p></div>;
  }
  return (
    <div className="card">
      <h2>Awaiting your decision</h2>
      {q.map(function (row) {
        return (
          <div className="ledger-li" key={row.submission.id}>
            <span style={{ fontSize: 20 }}>{row.child.avatar}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b>{row.child.name}</b> · {row.questIcon} {row.questTitle}
              {row.reward && <div className="note" style={{ margin: 0 }}>releases +{row.reward.energy}⚡ +{row.reward.coins}✦ +{row.reward.xp}xp</div>}
            </span>
            <span style={{ display: 'flex', gap: 6, flex: '0 0 auto' }}>
              <button className="mini go" onClick={async function () { const r = await props.store.dispatch(A.approve(row.submission.id)); if (r.ok) Sfx.coin(); }}>Approve</button>
              <button className="mini" onClick={function () { props.store.dispatch(A.reject(row.submission.id)); }}>Reject</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function ParentFamily(props) {
  const fam = props.state.family;
  return (
    <React.Fragment>
      {fam.length === 0 && <div className="card"><h2>No children yet</h2><p className="note" style={{ marginTop: 0 }}>Lock the ledger and tap "+ New child" from the child screen.</p></div>}
      {fam.map(function (f) {
        const g = f.guardian;
        return (
          <div className="card" key={f.child.id}>
            <div className="b-row" style={{ borderBottom: 'none', padding: 0 }}>
              <div className="b-thumb">
                {g ? <Art srcs={stageArt(g.species, g.level)} emoji={speciesOf(g.species).emoji} alt="" /> : <span>🧒</span>}
              </div>
              <div className="b-main">
                <div style={{ fontWeight: 700 }}>{f.child.avatar} {f.child.name}</div>
                {g && <div className="note" style={{ margin: 0 }}>
                  {g.name} · Lv <b className="num">{g.level}</b> · ⚡<b className="num">{g.energy}/{g.maxEnergy}</b> · ✦<b className="num">{g.gold}</b> · 🔥<b className="num">{f.streak}</b>
                </div>}
              </div>
              {f.pendingCount > 0 && <span className="seal">{f.pendingCount} waiting</span>}
            </div>
          </div>
        );
      })}
    </React.Fragment>
  );
}

function ParentSettings(props) {
  const store = props.store;
  const state = props.state;
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(null);
  const [motionPref, setMotionPref] = useState('auto');
  useEffect(function () {
    props.storeCtx.current.repos.meta.get('pref.motion').then(function (v) {
      setMotionPref(v || 'auto');
    });
  }, []);
  const [results, setResults] = useState([]);
  const [running, setRunning] = useState(false);
  const [counts, setCounts] = useState(null);
  const fileRef = useRef(null);
  const kids = S.selectChildren(state);

  async function exportBackup() {
    const r = await store.dispatch(A.exportBackup());
    if (!r.ok) return;
    const blob = new Blob([JSON.stringify(r.data)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'guardian-hearth-backup-' + G.TimeUtil.todayStr() + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  async function onImportFile(ev) {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const backup = JSON.parse(await file.text());
      await store.dispatch(A.importBackup(backup));
    } catch (e) {
      store.dispatch({ type: G.ActionTypes.TOAST_SHOW, scope: 'main', kind: 'bad', text: 'Import refused: ' + ((e && e.message) || e) + ' Nothing was changed.' });
    }
  }
  async function runTests() {
    setRunning(true); setResults([]);
    try {
      const out = [];
      await G.TestSuite.runAll(makeTestEnv, function (r) { out.push(r); setResults(out.slice()); });
    } catch (e) {
      store.dispatch({ type: G.ActionTypes.TOAST_SHOW, scope: 'main', kind: 'bad', text: 'Inspection stopped: ' + ((e && e.message) || e) });
    }
    setRunning(false);
  }
  async function inspectSeed() {
    const out = [];
    for (const s of G.STORE_NAMES) out.push({ store: s, count: await props.storeCtx.current.db.count(s) });
    setCounts(out);
  }
  const passed = results.filter(function (r) { return r.ok; }).length;
  const failed = results.length - passed;

  return (
    <React.Fragment>
      <div className="card">
        <h2>Keeper's PIN</h2>
        <input className="field" type="password" inputMode="numeric" autoComplete="off" value={oldPin} maxLength={12}
          placeholder="Current PIN" onChange={function (e) { setOldPin(e.target.value); }} />
        <input className="field" type="password" inputMode="numeric" autoComplete="off" value={newPin} maxLength={12}
          placeholder="New PIN (4–12 digits)" onChange={function (e) { setNewPin(e.target.value); }} />
        <button className="btn" onClick={async function () {
          const r = await store.dispatch(A.changePin(oldPin, newPin));
          if (r.ok) { setOldPin(''); setNewPin(''); }
        }}>Change PIN</button>
        {state.ui.gateToast && (
          <div className={'toast ' + (state.ui.gateToast.kind === 'ok' ? 'ok' : 'bad')} style={{ position: 'static', marginTop: 10 }}>
            {state.ui.gateToast.text}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Sol's Welcome Story</h2>
        <p className="note" style={{ marginTop: 0 }}>Replay the magical first-time intro where Sol greets your child and shows them how to begin.</p>
        <button className="btn" onClick={function () {
          try { localStorage.removeItem(SOL_WELCOME_KEY); localStorage.removeItem(COACH_KEY); } catch (e) {}
          window.location.reload();
        }}>🔥 Replay Sol's Welcome</button>
      </div>

      <div className="card">
        <h2>Backups</h2>
        <p className="note" style={{ marginTop: 0 }}>Export regularly — the file is checksummed, and a modified backup is refused before anything is written. This protects against iOS clearing browser data.</p>
        <div className="btnrow" style={{ marginTop: 10 }}>
          <button className="btn" onClick={exportBackup}>Export backup</button>
          <button className="btn" onClick={function () { if (fileRef.current) fileRef.current.click(); }}>Import backup</button>
        </div>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={onImportFile} />
      </div>

      <div className="card">
        <h2>Integrity</h2>
        <div className="btnrow">
          <button className="btn" onClick={function () { store.dispatch(A.verifyChain()); }}>Verify audit chain</button>
          <button className="btn" onClick={function () { store.dispatch(A.recoverRewards()); }}>Recover rewards</button>
        </div>
      </div>

      {kids.length > 0 && (
        <div className="card">
          <h2>Children</h2>
          {kids.map(function (c) {
            return (
              <div className="ledger-li" key={c.id}>
                <span style={{ fontSize: 18 }}>{c.avatar}</span>
                <span style={{ flex: 1 }}>{c.name}</span>
                {confirmRemove === c.id ? (
                  <span style={{ display: 'flex', gap: 6 }}>
                    <button className="mini" style={{ borderColor: '#5C3430', color: '#F0C9C2' }}
                      onClick={function () { setConfirmRemove(null); store.dispatch(A.removeChild(c.id)); }}>
                      Yes, remove
                    </button>
                    <button className="mini" onClick={function () { setConfirmRemove(null); }}>Keep</button>
                  </span>
                ) : (
                  <button className="mini" onClick={function () { setConfirmRemove(c.id); }}>Remove…</button>
                )}
              </div>
            );
          })}
          <p className="note">Removing a child deletes their guardian, island, and items. The audit history is kept by design.</p>
        </div>
      )}

      <div className="card">
        <h2>Animations</h2>
        <p className="note" style={{ marginTop: 0 }}>By default the game follows the device's Reduce Motion accessibility setting. "Always on" overrides it on this device.</p>
        <div className="btnrow" style={{ marginTop: 10 }}>
          <button className={'btn' + (motionPref !== 'on' ? ' primary' : '')}
            onClick={function () { setMotionPref('auto'); applyMotionPref('auto'); props.storeCtx.current.repos.meta.set('pref.motion', 'auto'); }}>
            Follow device
          </button>
          <button className={'btn' + (motionPref === 'on' ? ' primary' : '')}
            onClick={function () { setMotionPref('on'); applyMotionPref('on'); props.storeCtx.current.repos.meta.set('pref.motion', 'on'); }}>
            Always on
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Time controls (testing)</h2>
        <p className="note" style={{ marginTop: 0 }}>Fast-forward to test expedition timers. Careful: jumping past midnight confuses daily limits and streaks. If quests or approvals ever act stuck, run Repair below — it also runs automatically at every launch.</p>
        <div style={{ margin: '8px 0' }}>
          <span className="seal num">clock {TIME.offset === 0 ? 'normal' : '+' + Math.round(TIME.offset / 60000) + ' min'}</span>
        </div>
        <div className="btnrow">
          <button className="btn" onClick={function () { TIME.offset += 10 * 60000; store.dispatch(A.tick(gameNow())); }}>⏩ 10 min</button>
          <button className="btn" onClick={function () { TIME.offset += 60 * 60000; store.dispatch(A.tick(gameNow())); }}>⏩ 1 hour</button>
          <button className="btn" onClick={function () { TIME.offset = 0; store.dispatch(A.tick(gameNow())); }}>↩ Reset clock</button>
        </div>
        <div className="btnrow" style={{ marginTop: 9 }}>
          <button className="btn" onClick={function () { store.dispatch(A.repairTime()); }}>🩹 Repair time travel</button>
        </div>
      </div>

      <div className="card">
        <h2>Inspection</h2>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 10 }}>
          <span className="seal num">{G.TestSuite.count} checks</span>
          {results.length > 0 && <span className="seal num">{passed} passed</span>}
          {failed > 0 && <span className="seal bad num">{failed} failed</span>}
        </div>
        <div className="btnrow">
          <button className="btn" onClick={runTests} disabled={running}>{running ? 'Inspecting…' : 'Run all tests'}</button>
          <button className="btn" onClick={inspectSeed}>Data counts</button>
        </div>
        {results.length > 0 && (
          <ul className="ledger" style={{ marginTop: 12 }}>
            {results.map(function (r, i) {
              return (
                <li key={i} className={r.ok ? '' : 'fail'}>
                  <span>{(r.ok ? '✓ ' : '✕ ') + r.name}{!r.ok && <span className="err">{r.error}</span>}</span>
                  <span className="ms">{r.ms}ms</span>
                </li>
              );
            })}
          </ul>
        )}
        {counts && (
          <table className="counts" style={{ marginTop: 12 }}><tbody>
            {counts.map(function (c) { return (<tr key={c.store}><td>{c.store}</td><td>{c.count}</td></tr>); })}
          </tbody></table>
        )}
        <p className="note">Build GOTH-3.0-{APP_VERSION} · tests run in a separate database; family data is never touched.</p>
      </div>
    </React.Fragment>
  );
}

// DEBUG: surface any runtime error on screen (device-only bugs are otherwise invisible).
(function () {
  function showErr(msg) {
    try {
      var bar = document.getElementById('goth-errbar');
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'goth-errbar';
        bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7a1414;color:#fff;font:12px monospace;padding:8px 12px;max-height:40vh;overflow:auto;white-space:pre-wrap;border-top:2px solid #ff6b6b;';
        bar.onclick = function () { bar.style.display = 'none'; };
        document.body.appendChild(bar);
      }
      bar.style.display = 'block';
      bar.textContent = '⚠ ' + msg + '\n(tap to dismiss)';
    } catch (e) {}
  }
  window.addEventListener('error', function (e) {
    showErr((e && e.message ? e.message : 'error') + (e && e.filename ? ' @ ' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    showErr('Promise: ' + (e && e.reason ? (e.reason.message || e.reason) : 'rejected'));
  });
})();

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('./sw.js').catch(function () { /* offline shell is optional */ });
  });
}
