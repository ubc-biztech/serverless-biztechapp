import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";
import SQS from "aws-sdk/clients/sqs.js";

const { enqueuePendingTrades } = await loadBtx('export { enqueuePendingTrades } from "./workers"');

const projectId = "test-event:listing";
const tradeId = "order";
const insert = {
  Records: [{
    eventName: "INSERT",
    dynamodb: { Keys: { projectId: { S: projectId }, tradeId: { S: tradeId } } }
  }]
};

test("a new pending trade sends one order to the market FIFO group", async t => {
  const send = t.mock.method(SQS.prototype, "makeRequest", () => ({ promise: async () => ({}) }));
  await enqueuePendingTrades(insert);
  assert.equal(send.mock.callCount(), 1);
  const [operation, message] = send.mock.calls[0].arguments;
  assert.equal(operation, "sendMessage");
  assert.deepEqual(JSON.parse(message.MessageBody), { type: "TRADE", projectId, tradeId });
  assert.equal(message.MessageGroupId, "btx-trades");
});

test("a failed queue send fails the stream invocation so Lambda can retry", async t => {
  const failure = new Error("Queue unavailable");
  t.mock.method(SQS.prototype, "makeRequest", () => ({ promise: async () => { throw failure; } }));
  await assert.rejects(enqueuePendingTrades(insert), failure);
});

test("updating an existing trade does not enqueue another order", async t => {
  const send = t.mock.method(SQS.prototype, "makeRequest", () => assert.fail("unexpected SQS call"));
  await enqueuePendingTrades({ Records: [{ ...insert.Records[0], eventName: "MODIFY" }] });
  assert.equal(send.mock.callCount(), 0);
});
