import test from "node:test";
import assert from "node:assert/strict";
import { canTransition, transitionError, allowedNext } from "../server/logic/requests.js";

test("allowed transitions: submitted->approved->done and submitted->done", () => {
  assert.ok(canTransition("submitted", "approved"));
  assert.ok(canTransition("approved", "done"));
  assert.ok(canTransition("submitted", "done"));
  assert.deepEqual(allowedNext("submitted"), ["approved", "done"]);
  assert.deepEqual(allowedNext("done"), []);
});

test("everything else is rejected with a clear message", () => {
  for (const [from, to] of [["approved", "submitted"], ["done", "approved"], ["done", "submitted"], ["done", "done"], ["submitted", "submitted"], ["approved", "approved"]]) {
    assert.ok(!canTransition(from, to), `${from}->${to}`);
    assert.ok(transitionError(from, to), `${from}->${to}`);
  }
  assert.match(transitionError("done", "approved"), /cannot go from done to approved/);
  assert.match(transitionError("submitted", "bogus"), /Status must be/);
  assert.equal(transitionError("submitted", "approved"), null);
});
