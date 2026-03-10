'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONFIG_PATH = process.env.XRAY_CONFIG_PATH || '/xray/config.json';
const INBOUND_TAG = 'vless-reality';

function readConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to read xray config: ${err.message}`);
  }
}

function writeConfig(config) {
  try {
    // Write directly — Docker bind mounts don't support cross-mount rename
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (err) {
    throw new Error(`Failed to write xray config: ${err.message}`);
  }
}

function getInbound(config) {
  const inbound = config.inbounds.find(i => i.tag === INBOUND_TAG);
  if (!inbound) {
    throw new Error(`Inbound with tag "${INBOUND_TAG}" not found in config`);
  }
  return inbound;
}

async function reloadConfig() {
  // Send SIGUSR1 to the xray container via Docker socket API.
  // This avoids needing the docker CLI binary inside the api container.
  return new Promise((resolve) => {
    const http = require('http');
    const req = http.request(
      {
        socketPath: '/var/run/docker.sock',
        path: '/containers/xray/kill?signal=SIGUSR1',
        method: 'POST',
      },
      (res) => {
        res.resume();
        if (res.statusCode === 204) {
          console.log('[xray] SIGUSR1 sent — config reloaded');
        } else {
          console.error('[xray] Docker kill returned status', res.statusCode);
        }
        resolve();
      }
    );
    req.on('error', (err) => {
      console.error('[xray] Failed to send reload signal via docker socket:', err.message);
      resolve(); // non-fatal
    });
    req.end();
  });
}

/**
 * Add a VLESS client to the inbound.
 * @param {string} uuid  - UUID for the client
 * @param {string} email - Unique identifier / label (used for stats)
 */
async function addClient(uuid, email) {
  if (!uuid || !email) {
    throw new Error('uuid and email are required');
  }

  const config = readConfig();
  const inbound = getInbound(config);

  const existing = inbound.settings.clients.find(
    c => c.id === uuid || c.email === email
  );
  if (existing) {
    throw new Error(`Client with uuid "${uuid}" or email "${email}" already exists`);
  }

  inbound.settings.clients.push({
    id: uuid,
    email: email,
    flow: 'xtls-rprx-vision',
  });

  writeConfig(config);
  await reloadConfig();
  console.log(`[xray] Client added: ${email} (${uuid})`);
}

/**
 * Remove a VLESS client by UUID.
 * @param {string} uuid
 */
async function removeClient(uuid) {
  if (!uuid) {
    throw new Error('uuid is required');
  }

  const config = readConfig();
  const inbound = getInbound(config);

  const before = inbound.settings.clients.length;
  inbound.settings.clients = inbound.settings.clients.filter(c => c.id !== uuid);

  if (inbound.settings.clients.length === before) {
    throw new Error(`Client with uuid "${uuid}" not found`);
  }

  writeConfig(config);
  await reloadConfig();
  console.log(`[xray] Client removed: ${uuid}`);
}

/**
 * Get traffic stats for a client by email.
 * Uses Xray gRPC stats API.
 * @param {string} email
 * @returns {{ uplink: number, downlink: number }}
 */
async function getStats(email) {
  if (!email) {
    throw new Error('email is required');
  }

  const addr = process.env.XRAY_API_ADDR || 'xray:8080';

  try {
    // Use xray's built-in API tool via the xray binary
    // The API is exposed via gRPC on XRAY_API_ADDR
    // We query via the StatsService
    const uplinkResult = safeExecStats(addr, `user>>>${email}>>>traffic>>>uplink`);
    const downlinkResult = safeExecStats(addr, `user>>>${email}>>>traffic>>>downlink`);

    return {
      email,
      uplink: uplinkResult,
      downlink: downlinkResult,
    };
  } catch (err) {
    console.error(`[xray] Failed to get stats for ${email}:`, err.message);
    return { email, uplink: 0, downlink: 0, error: err.message };
  }
}

function safeExecStats(addr, name) {
  try {
    const result = execSync(
      `xray api stats --server=${addr} -name "${name}" -reset=false 2>/dev/null`,
      { shell: true, timeout: 5000 }
    ).toString();

    const match = result.match(/"value":\s*"?(\d+)"?/);
    return match ? parseInt(match[1], 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * List all current clients from config.
 * @returns {Array<{ id: string, email: string }>}
 */
function listClients() {
  const config = readConfig();
  const inbound = getInbound(config);
  return inbound.settings.clients.map(c => ({ id: c.id, email: c.email }));
}

module.exports = {
  addClient,
  removeClient,
  getStats,
  reloadConfig,
  listClients,
};
