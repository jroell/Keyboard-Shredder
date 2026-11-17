import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Transport } from '../src/lib/transport';

function clockFixture() {
  const reading = { contextTime: 3, performanceTime: 0 };
  const context = {
    state: 'running', currentTime: 2, baseLatency: 0.015, outputLatency: 0.025,
    getOutputTimestamp: () => reading,
    createBufferSource: () => ({ connect() {}, start() {} }),
  };
  return { context, reading, transport: new Transport(context as unknown as AudioContext, {} as AudioBuffer) };
}

test('A stale output timestamp falls back to the render clock with 40 ms of latency', async () => {
  const { transport, context, reading } = clockFixture();
  await transport.start(500, 0);
  context.currentTime = 3;
  reading.contextTime = 0.4;
  reading.performanceTime = performance.now();
  const time = transport.timeMs();
  assert.ok(Math.abs(time - 1460) < 5, `Expected 1460 ms of song time, received ${time} ms`);
});

test('A valid output timestamp maps a key pressed 20 ms ago to its audible song time', async () => {
  const { transport, context, reading } = clockFixture();
  await transport.start(500, 0);
  context.currentTime = 3;
  reading.contextTime = 2.93;
  reading.performanceTime = performance.now();
  const time = transport.timeMs(reading.performanceTime - 20);
  assert.ok(Math.abs(time - 1410) < 5, `Expected 1410 ms of song time, received ${time} ms`);
});
