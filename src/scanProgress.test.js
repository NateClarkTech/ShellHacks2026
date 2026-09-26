import assert from "node:assert/strict";
import test from "node:test";
import {
  noteScanProgress,
  readScanEvents,
  readingProgress,
  scanTimeLabel,
  secondsLeft,
  sightSeconds,
} from "./scanProgress.js";

test("the scan estimate is 1.25 seconds for every four cards", () => {
  assert.equal(sightSeconds(0), 0);
  assert.equal(sightSeconds(1), 1.25);
  assert.equal(sightSeconds(4), 1.25);
  assert.equal(sightSeconds(5), 2.5);
  assert.equal(sightSeconds(8), 2.5);
});

test("the line under the loading bar estimates the time left", () => {
  assert.equal(scanTimeLabel(null), "Reading the cards…");
  assert.equal(scanTimeLabel(2.5), "About 3 seconds left");
  assert.equal(scanTimeLabel(1.25), "About 2 seconds left");
  assert.equal(scanTimeLabel(1), "About 1 second left");
  assert.equal(scanTimeLabel(0.4), "Less than a second left");
  assert.equal(scanTimeLabel(0), "Finishing…");
});

test("a clock behind the progress stamp does not push the bar backward", () => {
  const progress = { seconds: 2.5, budget: 2.5, at: 1000, done: 0, total: 8 };
  assert.equal(secondsLeft(progress, 900), 2.5);
  assert.equal(secondsLeft(progress, 3500), 0);
});

test("the countdown keeps its start when later cards finish", () => {
  const reading = readingProgress(50);
  const started = noteScanProgress(
    reading,
    { done: 0, total: 8, seconds: 2.5, budget: 2.5 },
    80,
  );
  assert.equal(started.at, 80);
  assert.equal(started.budget, 2.5);
  const next = noteScanProgress(started, { done: 4, total: 8, seconds: 2.5, budget: 2.5 }, 1080);
  assert.equal(next.at, 80);
  assert.equal(next.done, 4);
  assert.equal(secondsLeft(next, 1080), 1.5);
  assert.equal(scanTimeLabel(secondsLeft(next, 1080)), "About 2 seconds left");
});

test("a progress line arrives before the scan result", async () => {
  const encoder = new TextEncoder();
  const chunks = [
    '{"event":"progress","done":0,"tot',
    'al":4,"seconds":1.25,"budget":1.25}\n',
    '{"event":"result","scene":"close","warnings":[],"cardsight":[],"ocr":[],"photoId":"p","glare":0,"replayed":false}\n',
  ];
  let index = 0;
  const stream = new ReadableStream({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[index]));
      index += 1;
    },
  });
  const seen = [];
  const payload = await readScanEvents(new Response(stream), (event) => {
    seen.push(event);
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].total, 4);
  assert.equal(seen[0].budget, 1.25);
  assert.equal(payload.scene, "close");
  assert.equal(payload.photoId, "p");
  assert.equal("event" in payload, false);
});

test("a stream error is the scan failure", async () => {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"event":"error","detail":"CardSight rate limit reached."}\n'));
      controller.close();
    },
  });
  await assert.rejects(readScanEvents(new Response(stream), () => {}), /rate limit/);
});
