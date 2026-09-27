import { lookupName } from "./index.js";
import { normName } from "../vision.js";

const memory = new Map();
const pending = new Map();

export function clearCardCache() {
  memory.clear();
  pending.clear();
}

function remember(name, card) {
  const key = normName(name);
  if (key) memory.set(key, card);
  return card;
}

export function cachedCard(name) {
  const local = lookupName(name);
  if (local) return { ...local, tags: local.tags ?? [], matched_name: null };
  const key = normName(name);
  if (!key) return null;
  return memory.get(key) ?? null;
}

async function fetchCard(name, fetchImpl) {
  const response = await fetchImpl(`/api/card?name=${encodeURIComponent(name)}`);
  if (response.status === 404) return { missing: true };
  if (!response.ok) {
    const error = new Error("down");
    error.code = "down";
    throw error;
  }
  return response.json();
}

export function loadCard(name, fetchImpl = globalThis.fetch) {
  const local = cachedCard(name);
  if (local) return Promise.resolve(local);
  const key = normName(name);
  if (!key) return Promise.resolve(null);
  if (memory.has(key)) return Promise.resolve(memory.get(key));
  if (pending.has(key)) return pending.get(key);
  const job = fetchCard(name, fetchImpl)
    .then((card) => {
      pending.delete(key);
      if (card?.missing) return card;
      return remember(name, card);
    })
    .catch((error) => {
      pending.delete(key);
      throw error;
    });
  pending.set(key, job);
  return job;
}
