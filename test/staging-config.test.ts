import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STAGING_CONFIG,
  STAGING_WEBSOCKET_HOSTS,
  assertStagingHost,
} from "../src/staging-config.ts";
test("staging config is pinned to the approved independent project", () => {
  assert.deepEqual(STAGING_CONFIG, {
    projectId: "qlist-staging",
    databaseURL: "https://qlist-staging-default-rtdb.firebaseio.com",
  });
  assert.ok(Object.isFrozen(STAGING_CONFIG));
  assert.deepEqual(STAGING_WEBSOCKET_HOSTS, [
    "qlist-staging-default-rtdb.firebaseio.com",
  ]);
});
test("staging refuses production and unrelated hosts", () => {
  for (const host of [
    "qlist.cc",
    "www.qlist.cc",
    "qlist.netlify.app",
    "evil.netlify.app",
    "deploy-preview-1--qlist.netlify.app.evil.test",
  ])
    assert.throws(() => assertStagingHost(host));
  for (const host of [
    "localhost",
    "127.0.0.1",
    "deploy-preview-1--qlist.netlify.app",
    "6abebb393575bc000840c154--qlist.netlify.app",
  ])
    assert.doesNotThrow(() => assertStagingHost(host));
});
