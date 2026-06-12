'use strict';

const crypto = require('crypto');

const DEFAULT_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ENTRIES = 50;

// Map<snapshotId, { metadata, artifacts: Map<string, any>, expiresAt }>
const store = new Map();

function generateId() {
  return `snap_${crypto.randomBytes(8).toString('hex')}`;
}

function computeHash(value) {
  const content = typeof value === 'string' ? value : JSON.stringify(value);
  return `sha256:${crypto.createHash('sha256').update(content).digest('hex')}`;
}

function evictExpired() {
  const now = Date.now();
  for (const [id, entry] of store.entries()) {
    if (entry.expiresAt < now) store.delete(id);
  }
}

function evictOldest() {
  const oldest = store.keys().next().value;
  if (oldest) store.delete(oldest);
}

/**
 * Creates a new snapshot entry. Returns the snapshotId.
 */
function create({ url, finalUrl, ttlMs = DEFAULT_TTL_MS } = {}) {
  evictExpired();
  if (store.size >= MAX_ENTRIES) evictOldest();

  const snapshotId = generateId();
  const now = new Date();

  store.set(snapshotId, {
    metadata: {
      snapshot_id: snapshotId,
      url: url || null,
      final_url: finalUrl || url || null,
      created_at: now.toISOString(),
      expires_at: new Date(Date.now() + ttlMs).toISOString(),
    },
    artifacts: new Map(),
    expiresAt: Date.now() + ttlMs,
  });

  return snapshotId;
}

/**
 * Stores a named artifact in an existing snapshot.
 * Calling with artifact 'html' on first write also computes the hash.
 */
function setArtifact(snapshotId, name, value) {
  const entry = store.get(snapshotId);
  if (!entry || Date.now() > entry.expiresAt) return false;

  entry.artifacts.set(name, value);

  if (name === 'html' && typeof value === 'string') {
    entry.metadata.hash = computeHash(value);
    entry.metadata.html_size_bytes = Buffer.byteLength(value, 'utf8');
  }

  return true;
}

/**
 * Retrieves a named artifact. Returns null if not found or expired.
 */
function getArtifact(snapshotId, name) {
  const entry = store.get(snapshotId);
  if (!entry || Date.now() > entry.expiresAt) {
    store.delete(snapshotId);
    return null;
  }
  return entry.artifacts.get(name) ?? null;
}

/**
 * Returns metadata for a snapshot (no artifacts). Null if expired.
 */
function getMetadata(snapshotId) {
  const entry = store.get(snapshotId);
  if (!entry || Date.now() > entry.expiresAt) return null;
  return entry.metadata;
}

/**
 * Returns true if the snapshot exists and is not expired.
 */
function exists(snapshotId) {
  const entry = store.get(snapshotId);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) { store.delete(snapshotId); return false; }
  return true;
}

module.exports = { create, setArtifact, getArtifact, getMetadata, exists, computeHash };
