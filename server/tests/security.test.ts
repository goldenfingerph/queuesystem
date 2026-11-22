import assert from 'node:assert/strict';
import test from 'node:test';
import { isAllowedWebSocketOrigin } from '../ws/index.js';

test('LAN WebSocket origin policy requires an exact serialized origin and matching transport host', () => {
  assert.equal(isAllowedWebSocketOrigin('http://queue.local:4000', 'queue.local:4000', false), true);
  assert.equal(isAllowedWebSocketOrigin('https://queue.local:4000', 'queue.local:4000', true), true);
  assert.equal(isAllowedWebSocketOrigin('http://queue.local:4000', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin('https://queue.local:4000', 'queue.local:4000', false), false);
  assert.equal(isAllowedWebSocketOrigin('https://attacker.example', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin('https://queue.local:4000/path', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin('https://queue.local:4000/?next=attacker', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin('https://user@queue.local:4000', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin('https://queue.local:4000/#fragment', 'queue.local:4000', true), false);
  assert.equal(isAllowedWebSocketOrigin(undefined, 'queue.local:4000', false), false);
  assert.equal(isAllowedWebSocketOrigin('not-an-origin', 'queue.local:4000', false), false);
  assert.equal(isAllowedWebSocketOrigin('http://queue.local:4000', undefined, false), false);
});
