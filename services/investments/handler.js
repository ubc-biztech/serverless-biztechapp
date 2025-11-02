import helpers from "../../lib/handlerHelpers.js";
import db from "../../lib/db.js";
import { TEAMS_TABLE, USER_REGISTRATIONS_TABLE, INVESTMENTS_TABLE } from "../../constants/tables.js";
import crypto from "crypto";

export const invest = async (event, ctx, callback) => {
  /*
    Responsible for:
    - Decrementing the balance of the investor
    - Incrementing the balance of the team
    - Updating the DB with transaction + comments
    */

  const data = JSON.parse(event.body);

  helpers.checkPayloadProps(data, {
    investorId: {
      required: true,
      type: "string"
    },
    teamId: {
      required: true,
      type: "string"
    },
    amount: {
      required: true,
      type: "number"
    },
    comment: {
      required: true,
      type: "string"
    }
  });

  const investor = await db.getOne(data.investorId, USER_REGISTRATIONS_TABLE, {
    "eventID;year": "kickstart;2025" // hardcoded
  });

  const team = await db.getOne(data.teamId, TEAMS_TABLE, {
    "eventID;year": "kickstart;2025" // hardcoded
  });

  // only allow valid investors
  if (!investor) {
    return helpers.createResponse(400, {
      message: "Investor not found or not registered for event"
    });
  }

  // only allow valid teams
  if (!team) {
    return helpers.createResponse(400, {
      message: "Team not found for event"
    });
  }

  // investor cannot invest in their own team
  if (investor.teamId === team.id) {
    return helpers.createResponse(400, {
      message: "Investor cannot invest in their own team"
    });
  }

  // investor cannot invest more than their remaining balance
  if (data.amount > investor.balance) {
    return helpers.createResponse(400, {
      message: "Investor does not have enough balance"
    });
  }

  // 1. update investor balance
  const updateInvestorPromise = db.updateDBCustom({
    TableName: USER_REGISTRATIONS_TABLE + (process.env.ENVIRONMENT || ""),
    Key: {
      id: data.investorId,
      "eventID;year": "kickstart;2025"
    },
    UpdateExpression: "SET balance = :newBalance",
    ExpressionAttributeValues: {
      ":newBalance": investor.balance - data.amount,
    },
    ConditionExpression: "attribute_exists(id)",
    ReturnValues: "UPDATED_NEW",
  });

  // 2. update team funding
  const updateTeamPromise = db.updateDBCustom({
    TableName: TEAMS_TABLE + (process.env.ENVIRONMENT || ""),
    Key: {
      id: data.teamId,
      "eventID;year": "kickstart;2025"
    },
    UpdateExpression: "SET funding = :newFunding",
    ExpressionAttributeValues: {
      ":newFunding": team.funding + data.amount,
    },
    ConditionExpression: "attribute_exists(id)",
    ReturnValues: "UPDATED_NEW",
  });

  // 3. create investment
  const createInvestmentPromise = db.create({
    id: crypto.randomUUID(), // partition key
    ["eventID;year"]: "kickstart;2025", // sort key
    investorId: data.investorId,
    investorName: investor.fname,
    teamId: data.teamId,
    amount: data.amount,
    comment: data.comment,
    isPartner: investor.isPartner ?? false, // differentiate for judging
  }, INVESTMENTS_TABLE);

  await Promise.all([updateInvestorPromise, updateTeamPromise, createInvestmentPromise]);

  return helpers.createResponse(200, {
    message: "Investment successful"
  });
};

