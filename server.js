// ═══════════════════════════════════════════════════════════════════
//  GamePad Pro  —  GOD MODE  v6.0  ULTIMATE
//  Merged from v4.0 + v5.0  |  Best of both worlds
// ═══════════════════════════════════════════════════════════════════
'use strict';

const cluster = require('cluster');
const os      = require('os');

if (cluster.isPrimary) {
  const n = os.cpus().length;
  console.log(`\n  [Cluster] Primary PID=${process.pid} — forking ${n} workers...`);
  for (let i = 0; i < n; i++) cluster.fork();
  cluster.on('exit', (w, code) => {
    console.log(`  [Cluster] Worker ${w.process.pid} died (code ${code}) — respawning`);
    cluster.fork();
  });
  return;
}

const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

if (!isMainThread && workerData && workerData.__mouse) {
  let ax = 0, ay = 0;
  parentPort.on('message', m => { if (m.t === 'd') { ax += m.x; ay += m.y; } });
  setInterval(() => {
    if (ax || ay) { parentPort.postMessage({ t: 'f', x: ax, y: ay }); ax = 0; ay = 0; }
  }, 8);
  return;
}

const express          = require('express');
const http             = require('http');
const { WebSocketServer } = require('ws');
const path             = require('path');
const QRCode           = require('qrcode');
const qrcodeTerminal   = require('qrcode-terminal');

const PORT = process.env.PORT || 3000;

let robot = null, sw = 1920, sh = 1080;
(function () {
  for (const p of ['@jitsi/robotjs', 'robotjs']) {
    try {
      robot = require(p);
      robot.setMouseDelay(0);
      robot.setKeyboardDelay(0);
      const sc = robot.getScreenSize(); sw = sc.width; sh = sc.height;
      if (cluster.worker?.id === 1)
        console.log(`  [OK] robotjs loaded (${p}) — screen ${sw}x${sh}`);
      return;
    } catch (_) {}
  }
  if (cluster.worker?.id === 1) {
    console.warn('  [WARN] robotjs NOT loaded — DEMO mode (no real PC input)');
    console.warn('  Fix:   npm install @jitsi/robotjs   (or run as Admin)\n');
  }
})();

const mouseWorker = new Worker(__filename, { workerData: { __mouse: true } });
mouseWorker.on('message', m => {
  if (m.t === 'f' && robot) {
    try {
      const c = robot.getMousePos();
      robot.moveMouse(
        Math.max(1, Math.min(c.x + m.x, sw - 1)),
        Math.max(1, Math.min(c.y + m.y, sh - 1))
      );
    } catch (_) {}
  }
});

const DEFAULT_KEYMAP = Object.freeze({
  dpad_up:    { key: 'w',       label: 'W'     },
  dpad_down:  { key: 's',       label: 'S'     },
  dpad_left:  { key: 'a',       label: 'A'     },
  dpad_right: { key: 'd',       label: 'D'     },
  btn_a:      { key: 'space',   label: 'SPACE' },
  btn_b:      { key: 'escape',  label: 'ESC'   },
  btn_x:      { key: 'f',       label: 'F'     },
  btn_y:      { key: 'e',       label: 'E'     },
  btn_lb:     { key: 'q',       label: 'Q'     },
  btn_rb:     { key: 'r',       label: 'R'     },
  btn_lt:     { key: 'shift',   label: 'SHIFT' },
  btn_rt:     { key: 'control', label: 'CTRL'  },
  btn_start:  { key: 'return',  label: 'ENTER' },
  btn_select: { key: 'tab',     label: 'TAB'   },
  btn_ls:     { key: 'z',       label: 'Z'     },
  btn_rs:     { key: 'x',       label: 'X'     },
  jump:       { key: 'space',   label: 'SPACE' },
  reload:     { key: 'r',       label: 'R'     },
  crouch:     { key: 'c',       label: 'C'     },
  melee:      { key: 'v',       label: 'V'     },
  grenade:    { key: 'g',       label: 'G'     },
  interact:   { key: 'f',       label: 'F'     },
  map:        { key: 'm',       label: 'M'     },
  inventory:  { key: 'tab',     label: 'TAB'   },
  prone:      { key: 'z',       label: 'Z'     },
});

const C = {
  sens: 4.0, dz: 0.18, st: 0.75, invertY: false,
  keys: Object.create(null),
  ld: false, rd: false,
};

function applySettings(cfg) {
  if (cfg.sensitivity     != null) C.sens    = cfg.sensitivity * 0.5;
  if (cfg.deadzone        != null) C.dz      = cfg.deadzone;
  if (cfg.sprintThreshold != null) C.st      = cfg.sprintThreshold;
  if (cfg.invertY         != null) C.invertY = cfg.invertY;
}

function setKey(k, v) {
  if (C.keys[k] === v) return;
  C.keys[k] = v;
  if (robot) try { robot.keyToggle(k, v ? 'down' : 'up'); } catch (_) {}
}

function moveAnalog(x, y) {
  const d = Math.sqrt(x * x + y * y);
  setKey('w',     y < -C.dz);
  setKey('s',     y >  C.dz);
  setKey('a',     x < -C.dz);
  setKey('d',     x >  C.dz);
  setKey('shift', d > C.st && y < -C.dz);
}

function releaseAll() {
  ['w','a','s','d','shift'].forEach(k => setKey(k, false));
}

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocketServer({ server, perMessageDeflate: false });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

app.get('/api/info', async (req, res) => {
  const ips   = getAllIPs();
  const best  = ips[0]?.ip || 'localhost';
  const mobileUrl = `http://${best}:${PORT}/mobile.html`;
  const qr    = await QRCode.toDataURL(mobileUrl, {
    errorCorrectionLevel: 'H',
    margin: 1,
    color: { dark: '#00ff88', light: '#0a0a0f' },
  });
  res.json({
    ip: best, port: PORT, url: mobileUrl, qr,
    robotjs: !!robot, keymap: DEFAULT_KEYMAP,
    screen: `${sw}x${sh}`, worker: process.pid,
    uptime: Math.round(process.uptime()) + 's',
  });
});

app.get('/status', (_, res) => res.json({
  version: '6.0-ultimate',
  worker: process.pid, robotjs: !!robot, screen: `${sw}x${sh}`,
  rooms: rooms.size, keys: C.keys,
  sensitivity: C.sens, uptime: Math.round(process.uptime()) + 's',
}));

app.post('/api/key', (req, res) => {
  if (!robot) return res.json({ ok: false, reason: 'robotjs not available' });
  try {
    const { key, state } = req.body;
    robot.keyToggle(key, state);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, reason: e.message });
  }
});

app.post('/api/mouse', (req, res) => {
  if (!robot) return res.json({ ok: false, reason: 'robotjs not available' });
  try {
    const { dx, dy } = req.body;
    mouseWorker.postMessage({ t: 'd', x: Math.round(dx), y: Math.round(dy) });
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

const rooms = new Map();

wss.on('connection', (ws) => {
  let role   = null;
  let roomId = 'default';

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'register') {
      role   = msg.role;
      roomId = msg.room || 'default';

      if (!rooms.has(roomId))
        rooms.set(roomId, { mobile: null, pc: null, keymap: { ...DEFAULT_KEYMAP } });

      const room  = rooms.get(roomId);
      room[role]  = ws;

      ws.send(JSON.stringify({
        type: 'registered', role,
        robotjs: !!robot, keymap: room.keymap,
      }));

      const peer = role === 'mobile' ? room.pc : room.mobile;
      if (peer?.readyState === 1) {
        peer.send(JSON.stringify({ type: role + '_connected' }));
        ws.send(JSON.stringify({ type: (role === 'mobile' ? 'pc' : 'mobile') + '_connected' }));
      }

      if (cluster.worker?.id === 1)
        console.log(`  [+] ${role} joined room="${roomId}"  pid=${process.pid}`);
      return;
    }

    const room = rooms.get(roomId);
    if (!room) return;

    if (msg.type === 'move') {
      setImmediate(() => {
        const x = msg.x || 0, y = msg.y || 0;
        x === 0 && y === 0 ? releaseAll() : moveAnalog(x, y);
      });
      if (room.pc?.readyState === 1) room.pc.send(raw.toString());
      return;
    }

    if (msg.type === 'look') {
      let dx = (msg.dx || 0) * C.sens;
      let dy = (msg.dy || 0) * C.sens;
      if (C.invertY) dy = -dy;
      const rx = Math.round(dx), ry = Math.round(dy);
      if (rx || ry) mouseWorker.postMessage({ t: 'd', x: rx, y: ry });
      if (room.pc?.readyState === 1) room.pc.send(raw.toString());
      return;
    }

    if (msg.type === 'stick') {
      if (msg.side === 'left') {
        setImmediate(() => moveAnalog(msg.x || 0, msg.y || 0));
      } else if (msg.side === 'right' && robot) {
        const speed = 12;
        const dx = Math.round((msg.x || 0) * speed);
        const dy = Math.round((msg.y || 0) * speed);
        if (dx || dy) mouseWorker.postMessage({ t: 'd', x: dx, y: dy });
      }
      if (room.pc?.readyState === 1) room.pc.send(raw.toString());
      return;
    }

    if (msg.type === 'input' || msg.type === 'btn') {
      if (msg.b && msg.s !== undefined && robot) {
        const map = room.keymap[msg.b];
        if (map) {
          try { robot.keyToggle(map.key, msg.s === 1 ? 'down' : 'up'); } catch {}
        }
      }
      const { action: a, state: s } = msg;
      if (a === 'fire' && robot) {
        const w = s === 'press';
        if (C.ld !== w) { C.ld = w; try { robot.mouseToggle(w ? 'down' : 'up', 'left'); } catch {} }
      } else if (a === 'ads' && robot) {
        const w = s === 'press';
        if (C.rd !== w) { C.rd = w; try { robot.mouseToggle(w ? 'down' : 'up', 'right'); } catch {} }
      } else if (a && robot) {
        const km = DEFAULT_KEYMAP[a];
        if (km) {
          try {
            if      (s === 'tap')     robot.keyTap(km.key);
            else if (s === 'press')   robot.keyToggle(km.key, 'down');
            else if (s === 'release') robot.keyToggle(km.key, 'up');
          } catch {}
        }
      }
      if (room.pc?.readyState === 1) room.pc.send(raw.toString());
      return;
    }

    if (msg.type === 'settings') {
      applySettings(msg);
      return;
    }

    if (msg.type === 'keymap_update') {
      Object.assign(room.keymap, msg.keymap);
      const peer = role === 'mobile' ? room.pc : room.mobile;
      if (peer?.readyState === 1) peer.send(raw.toString());
      return;
    }

    if (role === 'mobile' && room.pc?.readyState === 1)
      room.pc.send(raw.toString());
    else if (role === 'pc' && room.mobile?.readyState === 1)
      room.mobile.send(raw.toString());
  });

  ws.on('close', () => {
    if (!roomId || !rooms.has(roomId)) return;
    const room = rooms.get(roomId);
    if (room[role] === ws) {
      room[role] = null;
      if (cluster.worker?.id === 1)
        console.log(`  [-] ${role} left room="${roomId}"`);
      const peer = role === 'mobile' ? room.pc : room.mobile;
      if (peer?.readyState === 1)
        peer.send(JSON.stringify({ type: role + '_disconnected' }));
    }
    releaseAll();
    if (robot) {
      try { robot.mouseToggle('up', 'left');  } catch {}
      try { robot.mouseToggle('up', 'right'); } catch {}
    }
    C.ld = false; C.rd = false;
  });

  ws.on('error', () => {});
});

function getAllIPs() {
  const nets = os.networkInterfaces();
  const ips  = [];
  for (const name of Object.keys(nets)) {
    for (const a of nets[name]) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const n = name.toLowerCase();
      if (n.includes('vmware') || n.includes('virtualbox') || n.includes('vethernet')) continue;
      let type = '📶 WiFi   ';
      if (n.includes('eth') || n.includes('ethernet') || n.includes('lan')) type = '🔌 Ethernet';
      else if (n.includes('usb') || n.includes('tether') || n.includes('rndis')) type = '🔗 USB    ';
      else if (n.includes('bt') || n.includes('bluetooth') || n.includes('pan'))  type = '🔵 BT PAN ';
      ips.push({ type, name, ip: a.address });
    }
  }
  return ips;
}

server.listen(PORT, '0.0.0.0', async () => {
  if (cluster.worker?.id !== 1) return;

  const ips  = getAllIPs();
  const best = ips[0]?.ip || 'localhost';

  console.log('\n  ╔══════════════════════════════════════════════════════╗');
  console.log('  ║  🎮  GAMEPAD PRO  —  GOD MODE  v6.0  ULTIMATE      ║');
  console.log('  ╠══════════════════════════════════════════════════════╣');

  if (!robot) {
    console.log('  ║  ⚠  DEMO MODE — robotjs not loaded                ║');
    console.log('  ║     npm install @jitsi/robotjs  then restart       ║');
    console.log('  ╠══════════════════════════════════════════════════════╣');
  }

  console.log(`  ║  PC PAGE   →  http://localhost:${PORT}/pc.html         ║`);
  if (ips.length === 0) {
    console.log(`  ║  Network   →  http://localhost:${PORT}                 ║`);
  } else {
    ips.forEach(({ type, ip }) =>
      console.log(`  ║  ${type}  →  http://${ip.padEnd(15)}:${PORT}      ║`));
  }
  console.log(`  ║  Status    →  http://localhost:${PORT}/status          ║`);
  console.log('  ╚══════════════════════════════════════════════════════╝\n');

  const localUrl = `http://${best}:${PORT}/mobile.html`;
  console.log('  📱 Scan with phone (local network):\n');
  qrcodeTerminal.generate(localUrl, { small: true });

  console.log('\n  🌐 Creating public tunnel (any network)...');
  try {
    const localtunnel = require('localtunnel');
    const tunnel = await localtunnel({ port: PORT });
    console.log(`\n  ✅ PUBLIC URL: ${tunnel.url}`);
    console.log('  📱 Share to connect from ANY network:\n');
    qrcodeTerminal.generate(tunnel.url + '/mobile.html', { small: true });
    tunnel.on('close', () => console.log('\n  [Tunnel] Public URL closed.'));
    tunnel.on('error', () => console.log('\n  [Tunnel] Tunnel error.'));
  } catch (_) {
    console.log('  [Tunnel] Could not create public URL (offline or npm install localtunnel).');
  }

  console.log('\n  Waiting for phone... (Ctrl+C to stop)\n');

  let lastIPs = JSON.stringify(ips);
  setInterval(() => {
    const current = JSON.stringify(getAllIPs());
    if (current !== lastIPs) {
      lastIPs = current;
      console.log('\n  [Network] Change detected — updated interfaces:');
      getAllIPs().forEach(({ type, ip }) =>
        console.log(`    ${type}  →  http://${ip}:${PORT}`));
      console.log('');
    }
  }, 3000);
});
