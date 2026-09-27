import assert from "node:assert/strict";
import test from "node:test";
import {
  READ_SECONDS,
  noteScanProgress,
  openingSeconds,
  readFill,
  readScanEvents,
  readingProgress,
  scanTimeLabel,
  scanView,
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

test("the bar starts empty and the time is already on the screen", () => {
  const start = readingProgress(0);
  const opened = scanView(start, 0);
  assert.equal(opened.fraction, 0);
  assert.equal(opened.label, scanTimeLabel(openingSeconds(0)));
  assert.match(opened.label, /^About \d+ seconds left$/);

  const midway = scanView(start, READ_SECONDS * 500);
  assert.ok(midway.fraction > opened.fraction);
  assert.ok(midway.fraction < 0.62);
  assert.ok(openingSeconds(READ_SECONDS / 2) < openingSeconds(0));
});

test("CardSight continues the bar instead of starting it over", () => {
  const reading = readingProgress(0);
  const before = readFill(2);
  const started = noteScanProgress(
    reading,
    { done: 0, total: 4, seconds: 1.25, budget: 1.25 },
    2000,
  );
  assert.equal(started.readFraction, before);
  const view = scanView(started, 2000);
  assert.equal(view.fraction, before);
  assert.equal(view.label, "About 2 seconds left");
  const later = scanView(started, 2625);
  assert.ok(later.fraction > view.fraction);
  assert.ok(later.fraction < 1);
  assert.equal(scanView(started, 4000).fraction, 1);
});

test("a scan with nothing left for CardSight fills the bar", () => {
  const started = noteScanProgress(readingProgress(0), { done: 0, total: 0, seconds: 0, budget: 0 }, 500);
  const view = scanView(started, 500);
  assert.equal(view.fraction, 1);
  assert.equal(view.label, "Finishing…");
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
