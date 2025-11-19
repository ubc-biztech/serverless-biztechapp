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

  let investor = await db.getOne(data.investorId, USER_REGISTRATIONS_TABLE, {
    "eventID;year": "kickstart;2025" // hardcoded
  });
  let eventUsed = "kickstart;2025";

  if (!investor) {
    // if not an attendee, check if they are part of audience, as they can invest too
    investor = await db.getOne(data.investorId, USER_REGISTRATIONS_TABLE, {
      "eventID;year": "kickstart-showcase;2025" // hardcoded
    });
    eventUsed = "kickstart-showcase;2025";
  }

  if (!investor) {
    // if still not found, return error
    return helpers.createResponse(400, {
      message: "Investor not found or not registered for event"
    });
  }

  // teams can only be created by attendees
  const team = await db.getOne(data.teamId, TEAMS_TABLE, {
    "eventID;year": "kickstart;2025" // hardcoded
  });

  // only allow valid teams
  if (!team) {
    return helpers.createResponse(400, {
      message: "Team not found for event"
    });
  }

  // investor cannot invest in their own team
  if (investor.teamID === team.id) {
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
      "eventID;year": eventUsed // update for specific event (differentiate between showcase)
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
      "eventID;year": "kickstart;2025" // for teams, it will always be kickstart, since audience can't form teams
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
    ["eventID;year"]: eventUsed, // sort key
    investorId: data.investorId,
    investorName: investor.fname,
    teamId: data.teamId,
    teamName: team.teamName,
    amount: data.amount,
    comment: data.comment,
    isPartner: investor.isPartner ?? false, // differentiate for judging
    createdAt: new Date().getTime(),
  }, INVESTMENTS_TABLE);

  await Promise.all([updateInvestorPromise, updateTeamPromise, createInvestmentPromise]);

  return helpers.createResponse(200, {
    message: "Investment successful"
  });
};

export const teamStatus = async (event, ctx, callback) => {
  /*
    Responsible for:
    - Fetching team's current funding
    - Fetching all individual investments with comments
    */

  if (!event.pathParameters || !event.pathParameters.teamId) {
    return helpers.missingIdQueryResponse("teamId");
  }

  const teamId = event.pathParameters.teamId;

  // teams can only be created by attendees
  const team = await db.getOne(teamId, TEAMS_TABLE, {
    "eventID;year": "kickstart;2025"
  });

  if (!team) {
    return helpers.createResponse(400, {
      message: "Team not found for event"
    });
  }

  // Scan all investments made into this team
  // Utilize GSI
  // Already considers both kickstart and showcase
  const teamInvestments = await db.query(INVESTMENTS_TABLE, "team-investments", {
    expression: "#teamId = :teamId",
    expressionNames: {
      "#teamId": "teamId"
    },
    expressionValues: {
      ":teamId": `${teamId}`
    }
  });

  return helpers.createResponse(200, {
    funding: team.funding,
    investments: teamInvestments // each entry includes comment, investorId, investorName, amount
  });
};

export const investments = async (event, ctx, callback) => {
  /*
  Responsible for:
  - Fetching investments with optional limit, sorted by most recent first
  - Can limit based on query param (e.g. ?limit=4)
  */

  try {
    const investments = await db.scan(INVESTMENTS_TABLE);

    const limit = event.queryStringParameters?.limit ? parseInt(event.queryStringParameters.limit) : undefined;

    const data = investments.sort((a, b) => {
      return b.createdAt - a.createdAt;
    });

    if (!limit || isNaN(limit) || limit < 0) {
      // default to returning all
      return helpers.createResponse(200, data);
    }

    return helpers.createResponse(200, data.slice(0, limit));
  } catch (error) {
    return helpers.createResponse(500, {
      message: "Internal Server Error"
    });
  }
};

export const investorStatus = async (event, ctx, callback) => {
  /*
  Responsible for:
  - Fetching individual's balance left
  - Fetching all investments made by individual
  */

  if (!event.pathParameters || !event.pathParameters.investorId) {
    return helpers.missingIdQueryResponse("investorId");
  }

  const investorId = event.pathParameters.investorId;

  let investor = await db.getOne(investorId, USER_REGISTRATIONS_TABLE, {
    "eventID;year": "kickstart;2025"
  });

  if (!investor) {
    // if not an attendee, check if they are part of audience, as they can invest too
    investor = await db.getOne(investorId, USER_REGISTRATIONS_TABLE, {
      "eventID;year": "kickstart-showcase;2025"
    });
  }

  if (!investor) {
    // if still not found, return error
    return helpers.createResponse(400, {
      message: "Investor not found for event"
    });
  }

  // scan all investments made by this investor, utilize GSI
  // Already considers both kickstart and showcase
  const investorInvestments = await db.query(INVESTMENTS_TABLE, "investor-investments", {
    expression: "#investorId = :investorId",
    expressionNames: {
      "#investorId": "investorId"
    },
    expressionValues: {
      ":investorId": `${investorId}`
    }
  });

  return helpers.createResponse(200, {
    balance: investor.balance,
    investments: investorInvestments // each entry includes comment, teamId, teamName, amount
  });
};
