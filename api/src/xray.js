'use strict';

const fs   = require('fs');
const http = require('http');

const CONFIG_PATH = process.env.XRAY_CONFIG_PATH || '/xray/config.json';
const INBOUND_TAG = 'vless-reality';

// ── Config file helpers ───────────────────────────────────────────────────────

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read xray config: ${err.message}`);
  }
}

function writeConfig(config) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    throw new Error(`Failed to write xray config: ${err.message}`);
  }
}

function getInbound(config) {
  const inbound = config.inbounds.find(i => i.tag === INBOUND_TAG);
  if (!inbound) throw new Error(`Inbound "${INBOUND_TAG}" not found`);
  return inbound;
}

// ── Docker socket helpers ─────────────────────────────────────────────────────

function dockerRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = http.request(
      {
        socketPath: '/var/run/docker.sock',
        path,
        method,
        headers: body
          ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
          : {},
      },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/**
 * Parse Docker multiplexed stream (stdout/stderr interleaved).
 * Each frame: [stream_type(1), 0, 0, 0, size(4 BE)] + data
 */
function parseDockerStream(buf) {
  let out = '';
  let offset = 0;
  while (offset + 8 <= buf.length) {
    const size = buf.readUInt32BE(offset + 4);
    if (offset + 8 + size > buf.length) break;
    out += buf.slice(offset + 8, offset + 8 + size).toString();
    offset += 8 + size;
  }
  return out.trim();
}

/**
 * Run a command inside the xray container via Docker socket exec API.
 * Returns the combined stdout output as a string.
 */
async function dockerExec(cmd) {
  const create = await dockerRequest('POST', '/containers/xray/exec', {
    AttachStdout: true,
    AttachStderr: true,
    Cmd: cmd,
  });
  if (create.status !== 201) {
    throw new Error(`exec create failed: ${create.status}`);
  }
  const { Id } = JSON.parse(create.body.toString());

  const start = await dockerRequest('POST', `/exec/${Id}/start`, { Detach: false, Tty: false });
  return parseDockerStream(start.body);
}

/**
 * Read recent xray container log lines (stdout only) since a Unix timestamp.
 * Returns array of raw log strings.
 */
async function readXrayLogs(sinceUnixSec) {
  const res = await dockerRequest(
    'GET',
    `/containers/xray/logs?stdout=1&stderr=0&since=${sinceUnixSec}&timestamps=0`,
    null
  );
  if (res.status !== 200) return [];
  return parseDockerStream(res.body)
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
}

// ── Xray stats API ────────────────────────────────────────────────────────────

/**
 * Query all user traffic stats via xray statsquery API (Docker exec).
 * @param {boolean} reset  If true, resets counters after reading (incremental tracking).
 * @returns {Object}  { [email]: { uplink: number, downlink: number } }
 */
async function getAllStats(reset = true) {
  try {
    const output = await dockerExec([
      'xray', 'api', 'statsquery',
      '--server=127.0.0.1:8080',
      '-pattern=user',
      `-reset=${reset}`,
    ]);
    if (!output || output === '{}') return {};

    const data = JSON.parse(output);
    const result = {};
    for (const s of data.stat || []) {
      const m = s.name.match(/^user>>>(.+)>>>traffic>>>(up|down)link$/);
      if (!m) continue;
      const email = m[1];
      const dir   = m[2] === 'up' ? 'uplink' : 'downlink';
      if (!result[email]) result[email] = { uplink: 0, downlink: 0 };
      result[email][dir] = Number(s.value) || 0;
    }
    return result;
  } catch (err) {
    console.error('[xray] getAllStats error:', err.message);
    return {};
  }
}

/**
 * Get all currently online users from xray.
 * @returns {string[]}  Array of email strings (format: "userId_uuid")
 */
async function getOnlineUsers() {
  try {
    const output = await dockerExec([
      'xray', 'api', 'statsgetallonlineusers',
      '--server=127.0.0.1:8080',
    ]);
    if (!output || output === '{}') return [];
    const data = JSON.parse(output);
    // Returns { users: ["email1", "email2", ...] } or { usersOnline: [...] }
    return data.users || data.usersOnline || [];
  } catch (err) {
    console.error('[xray] getOnlineUsers error:', err.message);
    return [];
  }
}

/**
 * Get online IPs for a specific user email from xray.
 * @param {string} email
 * @returns {Array<{ ip: string, time: string }>}
 */
async function getOnlineIPs(email) {
  try {
    const output = await dockerExec([
      'xray', 'api', 'statsonlineiplist',
      '--server=127.0.0.1:8080',
      `-email=${email}`,
    ]);
    if (!output || output === '{}') return [];
    const data = JSON.parse(output);
    return data.ipList || data.ips || [];
  } catch (err) {
    return [];
  }
}

// ── Config hot-reload ─────────────────────────────────────────────────────────

async function reloadConfig() {
  try {
    const res = await dockerRequest('POST', '/containers/xray/kill?signal=SIGUSR1', null);
    if (res.status === 204) {
      console.log('[xray] SIGUSR1 sent — config reloaded');
    } else {
      console.error('[xray] Docker kill returned status', res.status);
    }
  } catch (err) {
    console.error('[xray] Failed to send reload signal:', err.message);
  }
}

// ── Client management ─────────────────────────────────────────────────────────

async function addClient(uuid, email) {
  if (!uuid || !email) throw new Error('uuid and email are required');

  const config  = readConfig();
  const inbound = getInbound(config);

  if (inbound.settings.clients.find(c => c.id === uuid || c.email === email)) {
    throw new Error(`Client with uuid "${uuid}" or email "${email}" already exists`);
  }

  inbound.settings.clients.push({ id: uuid, email, flow: 'xtls-rprx-vision' });
  writeConfig(config);
  await reloadConfig();
  console.log(`[xray] Client added: ${email} (${uuid})`);
}

async function removeClient(uuid) {
  if (!uuid) throw new Error('uuid is required');

  const config  = readConfig();
  const inbound = getInbound(config);
  const before  = inbound.settings.clients.length;

  inbound.settings.clients = inbound.settings.clients.filter(c => c.id !== uuid);
  if (inbound.settings.clients.length === before) {
    throw new Error(`Client with uuid "${uuid}" not found`);
  }

  writeConfig(config);
  await reloadConfig();
  console.log(`[xray] Client removed: ${uuid}`);
}

function listClients() {
  const config  = readConfig();
  const inbound = getInbound(config);
  return inbound.settings.clients.map(c => ({ id: c.id, email: c.email }));
}

module.exports = {
  addClient,
  removeClient,
  getAllStats,
  getOnlineUsers,
  getOnlineIPs,
  readXrayLogs,
  reloadConfig,
  listClients,
};
