// CardSight allows 4 calls per second. Keep this in step with
// SIGHT_BATCH_SECONDS in server/vision/cardsight.py.
export const SIGHT_BATCH = 4;
export const SIGHT_BATCH_SECONDS = 1.25;

export function sightSeconds(count) {
  if (!count || count <= 0) return 0;
  return Math.ceil(count / SIGHT_BATCH) * SIGHT_BATCH_SECONDS;
}

export function readingProgress(now = performance.now()) {
  return { seconds: null, budget: null, done: 0, total: 0, at: now };
}

export function noteScanProgress(current, event, now) {
  const seconds = Number(event?.seconds);
  const budget = Number(event?.budget);
  const nextBudget = Number.isFinite(budget) ? budget : sightSeconds(event?.total);
  const nextSeconds = Number.isFinite(seconds) ? seconds : nextBudget;
  if (current?.seconds != null && current.budget > 0) {
    return {
      ...current,
      done: event?.done ?? current.done,
      total: event?.total ?? current.total,
    };
  }
  return {
    done: event?.done ?? 0,
    total: event?.total ?? 0,
    seconds: nextSeconds,
    budget: nextBudget,
    at: now,
  };
}

export function scanTimeLabel(secondsLeft) {
  if (secondsLeft == null) return "Reading the cards…";
  if (secondsLeft <= 0) return "Finishing…";
  if (secondsLeft < 1) return "Less than a second left";
  const seconds = Math.ceil(secondsLeft);
  return seconds === 1 ? "About 1 second left" : `About ${seconds} seconds left`;
}

export function secondsLeft(progress, now) {
  if (progress?.seconds == null) return null;
  const budget = Number(progress.budget);
  let left = progress.seconds - (now - progress.at) / 1000;
  if (budget > 0) left = Math.min(budget, left);
  return Math.max(0, left);
}

function takeScanEvent(message, onProgress) {
  if (message.event === "progress") {
    onProgress(message);
    return null;
  }
  if (message.event === "error") {
    const detail = message.detail;
    throw new Error(typeof detail === "string" ? detail : "The scan did not finish.");
  }
  if (message.event === "result") {
    const result = { ...message };
    delete result.event;
    return result;
  }
  return null;
}

export async function readScanEvents(response, onProgress) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let payload = null;
  const consume = (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const result = takeScanEvent(JSON.parse(trimmed), onProgress);
    if (result) payload = result;
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer);
  if (!payload) throw new Error("The scan did not finish.");
  return payload;
}
