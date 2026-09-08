import assert from "node:assert/strict";
import db from "../../../lib/db.js";
import { PROFILE_TYPES, TYPES } from "../constants.js";
import {
  buildProfileUpsertParams,
  updateProfileFromMembershipData
} from "../helpers.js";
import sinon from "sinon";

describe("profile membership updates", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("builds an update that recreates a missing profile safely", () => {
    const params = buildProfileUpsertParams(
      "quiet-otter",
      {
        firstName: "Test",
        lastName: "User",
        pronouns: "They/Them",
        major: "Computer Science",
        year: "Undergraduate",
        linkedIn: "https://www.linkedin.com/in/test"
      },
      PROFILE_TYPES.ATTENDEE,
      1234
    );

    assert.deepEqual(params.Key, {
      compositeID: "PROFILE#quiet-otter",
      type: TYPES.PROFILE
    });
    assert.equal(
      params.ConditionExpression,
      "attribute_not_exists(#profileID) OR #profileID = :profileID"
    );
    assert.match(
      params.UpdateExpression,
      /#viewableMap = if_not_exists\(#viewableMap, :viewableMap\)/
    );
    assert.match(
      params.UpdateExpression,
      /#createdAt = if_not_exists\(#createdAt, :createdAt\)/
    );
    assert.match(params.UpdateExpression, /#fname = :fname/);
    assert.equal(params.ExpressionAttributeValues[":profileID"], "quiet-otter");
    assert.equal(
      params.ExpressionAttributeValues[":profileType"],
      PROFILE_TYPES.ATTENDEE
    );
    assert.equal(params.ExpressionAttributeValues[":createdAt"], 1234);
    assert.equal(params.ExpressionAttributeValues[":updatedAt"], 1234);
  });

  it("does not overwrite fields the caller did not supply", () => {
    // Shape of a member record as passed by grantMembership: no linkedIn/pronouns.
    const params = buildProfileUpsertParams(
      "quiet-otter",
      {
        firstName: "Test",
        lastName: "User",
        major: "Computer Science",
        year: "Undergraduate"
      },
      PROFILE_TYPES.ATTENDEE,
      1234
    );

    assert.match(params.UpdateExpression, /#fname = :fname/);
    assert.match(
      params.UpdateExpression,
      /#linkedIn = if_not_exists\(#linkedIn, :linkedIn\)/
    );
    assert.match(
      params.UpdateExpression,
      /#pronouns = if_not_exists\(#pronouns, :pronouns\)/
    );
  });

  it("submits the self-healing update to DynamoDB", async () => {
    const updateStub = sinon.stub(db, "updateDBCustom").resolves({});

    await updateProfileFromMembershipData(
      "quiet-otter",
      {
        firstName: "Test",
        lastName: "User"
      },
      PROFILE_TYPES.ATTENDEE
    );

    sinon.assert.calledOnce(updateStub);
    const params = updateStub.firstCall.args[0];
    assert.equal(params.Key.compositeID, "PROFILE#quiet-otter");
    assert.equal(params.ExpressionAttributeValues[":fname"], "Test");
    assert.equal(params.ExpressionAttributeValues[":lname"], "User");
  });
});
