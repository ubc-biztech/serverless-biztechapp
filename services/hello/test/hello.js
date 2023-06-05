"use strict";

// tests for hello
// Generated by serverless-mocha-plugin

import mochaPlugin from "serverless-mocha-plugin";
const expect = mochaPlugin.chai.expect;
const wrapped = mochaPlugin.getWrapper("hello", "/handler.js", "hello");

describe("hello", () => {
  before((done) => {
    done();
  });

  it("hello test", async () => {
    const response = await wrapped.run({
    });
    const body = JSON.parse(response.body);
    expect(response).to.not.be.empty;
    expect(body.message).to.equal("Yeet!");
    expect(response.statusCode).to.equal(200);
  });
});
