#!/usr/bin/env node
/**
 * Serveur IRTS Suite.
 *
 * Sert l'application construite et expose une base partagee : tous les postes
 * du reseau — ou d'Internet si la machine est exposee — travaillent sur les
 * memes donnees et voient les modifications des autres en direct.
 *
 * Aucune dependance : node:http, node:fs et le systeme de fichiers suffisent.
 *
 *   node server/index.js --port 8080 --data ./data
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const PORT = Number(arg('port', process.env.PORT ?? 8080));
const HOST = arg('host', process.env.HOST ?? '0.0.0.0');
const DATA_DIR = resolve(arg('data', process.env.IRTS_DATA ?? join(ROOT, 'data')));
const STATIC_DIR = resolve(arg('static', join(ROOT, 'dist')));
const DB_FILE = join(DATA_DIR, 'irts-db.json');
const MAX_BODY = 32 * 1024 * 1024;

/* ------------------------------------------------------------- persistance */

mkdirSync(DATA_DIR, { recursive: true });

/** Collections indexees par identifiant, fusionnees enregistrement par enregistrement. */
const COLLECTIONS = [
  'clients',
  'deals',
  'products',
  'packs',
  'docs',
  'projects',
  'staff',
  'assignments',
  'expenses',
  'tickets',
  'pages',
  'scenes',
  'tasks',
  'categories',
];

let state = load();

function load() {
  if (existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(DB_FILE, 'utf8'));
      if (parsed && parsed.db) return { revision: parsed.revision ?? 1, db: parsed.db, updatedAt: parsed.updatedAt };
    } catch (error) {
      console.error(`[irts] base illisible (${error.message}), demarrage a vide`);
    }
  }
  return { revision: 0, db: null, updatedAt: null };
}

/** Ecriture atomique : un fichier temporaire puis un renommage. */
function persist() {
  const tmp = `${DB_FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state), 'utf8');
  renameSync(tmp, DB_FILE);
}

/* ------------------------------------------------------- flux temps reel */

let clientSeq = 0;
const clients = new Map();

function broadcast(event, payload, exceptId) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const [id, client] of clients) {
    if (id === exceptId) continue;
    try {
      client.response.write(frame);
    } catch {
      clients.delete(id);
    }
  }
}

function presence() {
  return [...clients.values()].map((client) => ({ id: client.id, nom: client.nom, depuis: client.depuis }));
}

function announcePresence() {
  broadcast('presence', presence());
}

/* ----------------------------------------------------------------- outils */

function send(response, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
    ...headers,
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise((accept, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('corps de requête trop volumineux'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        accept(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on('error', reject);
  });
}

/**
 * Applique des operations enregistrement par enregistrement.
 * Deux postes qui modifient deux fiches differentes ne s'ecrasent jamais ;
 * sur une meme fiche, la derniere ecriture gagne.
 */
function applyOps(ops) {
  if (!state.db) return 0;
  let applied = 0;
  for (const op of ops) {
    if (op.kind === 'settings') {
      state.db.settings = { ...state.db.settings, ...op.value };
      applied += 1;
      continue;
    }
    if (op.kind === 'company') {
      const index = state.db.companies.findIndex((entry) => entry.id === op.id);
      if (index >= 0) state.db.companies[index] = op.value;
      applied += 1;
      continue;
    }
    if (!COLLECTIONS.includes(op.collection)) continue;
    const list = (state.db[op.collection] ||= []);
    const index = list.findIndex((entry) => entry.id === op.id);
    if (op.kind === 'delete') {
      if (index >= 0) list.splice(index, 1);
    } else if (index >= 0) {
      list[index] = op.value;
    } else {
      list.unshift(op.value);
    }
    applied += 1;
  }
  return applied;
}

/* --------------------------------------------------------------- fichiers */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
};

function serveStatic(request, response, pathname) {
  if (!existsSync(STATIC_DIR)) {
    send(
      response,
      503,
      {
        erreur: 'Application non construite',
        detail: 'Lancez « npm run build » puis relancez le serveur.',
      },
    );
    return;
  }
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let file = join(STATIC_DIR, safe);
  if (!file.startsWith(STATIC_DIR)) file = join(STATIC_DIR, 'index.html');
  if (!existsSync(file) || safe === '/' || safe === '\\') file = join(STATIC_DIR, 'index.html');
  const type = MIME[extname(file)] ?? 'application/octet-stream';
  const immutable = file.includes(`${join('assets')}`) ;
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(response);
}

/* ---------------------------------------------------------------- serveur */

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const { pathname } = url;

  if (request.method === 'OPTIONS') return send(response, 204, '');

  if (pathname === '/api/sante') {
    return send(response, 200, {
      service: 'irts-suite',
      revision: state.revision,
      initialisee: Boolean(state.db),
      postes: clients.size,
      majLe: state.updatedAt,
    });
  }

  if (pathname === '/api/etat' && request.method === 'GET') {
    return send(response, 200, { revision: state.revision, db: state.db, postes: presence() });
  }

  // Premiere connexion : le poste depose sa base locale comme base de reference.
  if (pathname === '/api/etat' && request.method === 'PUT') {
    try {
      const body = await readBody(request);
      if (!body.db) return send(response, 400, { erreur: 'base absente' });
      if (state.db && !body.forcer) {
        return send(response, 409, { erreur: 'base déjà initialisée', revision: state.revision, db: state.db });
      }
      state = { revision: state.revision + 1, db: body.db, updatedAt: new Date().toISOString() };
      persist();
      broadcast('revision', { revision: state.revision });
      return send(response, 200, { revision: state.revision });
    } catch (error) {
      return send(response, 400, { erreur: error.message });
    }
  }

  if (pathname === '/api/ops' && request.method === 'POST') {
    try {
      const body = await readBody(request);
      if (!state.db) return send(response, 409, { erreur: 'base non initialisée' });
      const applied = applyOps(Array.isArray(body.ops) ? body.ops : []);
      if (applied) {
        state.revision += 1;
        state.updatedAt = new Date().toISOString();
        persist();
        broadcast('revision', { revision: state.revision, par: body.poste ?? null }, body.poste ?? null);
      }
      return send(response, 200, { revision: state.revision, appliquees: applied });
    } catch (error) {
      return send(response, 400, { erreur: error.message });
    }
  }

  if (pathname === '/api/flux') {
    clientSeq += 1;
    const id = url.searchParams.get('poste') || `poste_${clientSeq}`;
    const nom = url.searchParams.get('nom') || 'Poste';
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    response.write(`retry: 3000\n\n`);
    response.write(`event: revision\ndata: ${JSON.stringify({ revision: state.revision })}\n\n`);
    clients.set(id, { id, nom, depuis: new Date().toISOString(), response });
    announcePresence();
    const beat = setInterval(() => {
      try {
        response.write(': battement\n\n');
      } catch {
        clearInterval(beat);
      }
    }, 25000);
    request.on('close', () => {
      clearInterval(beat);
      clients.delete(id);
      announcePresence();
    });
    return undefined;
  }

  if (pathname.startsWith('/api/')) return send(response, 404, { erreur: 'route inconnue' });

  return serveStatic(request, response, pathname);
});

server.listen(PORT, HOST, () => {
  const addresses = [];
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address);
    }
  }
  console.log('');
  console.log('  IRTS Suite — serveur partagé');
  console.log(`  Base de données : ${DB_FILE}`);
  console.log(`  Application     : ${existsSync(STATIC_DIR) ? STATIC_DIR : 'non construite (npm run build)'}`);
  console.log('');
  console.log(`  Sur cette machine : http://localhost:${PORT}`);
  for (const address of addresses) console.log(`  Sur le réseau     : http://${address}:${PORT}`);
  console.log('');
  console.log('  Chaque poste ouvre cette adresse : tous partagent la même base.');
  console.log('');
});
