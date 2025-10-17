import { USER_REGISTRATIONS_TABLE, INVESTMENTS_TABLE, TEAMS_TABLE } from "../../constants/tables";
import db from "../../lib/db";
import helpers from "../../lib/handlerHelpers";
import { v4 as uuidv4 } from 'uuid';

// WIP
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

    if (!investor) {
        return helpers.createResponse(400, {
            message: "Investor not found or not registered for event"
        });
    }
    
    if (!team) {
        return helpers.createResponse(400, {
            message: "Team not found for event"
        });
    }
    
    if (data.amount > investor.balance) {
        return helpers.createResponse(400, {
            message: "Investor does not have enough balance"
        });
    }

    const updateInvestorPromise = db.updateOne(data.investorId, USER_REGISTRATIONS_TABLE, {
        "eventID;year": "kickstart;2025" // hardcoded
    }, {
        balance: investor.balance - data.amount
    });

    const updateTeamPromise = db.updateOne(data.teamId, TEAMS_TABLE, {
        "eventID;year": "kickstart;2025" // hardcoded
    }, {
        funding: team.funding + data.amount
    });

    const updateTransactionPromise = db.create({
        id: uuidv4(), // partition key (?)
        ["investor#team"]: `${data.investorId}#${data.teamId}`, // sort key (?)
        investorId: data.investorId,
        investorName: investor.fname,
        teamId: data.teamId,
        amount: data.amount,
        comment: data.comment,
        ["eventID;year"]: "kickstart;2025",
    }, INVESTMENTS_TABLE);

    await Promise.all([updateInvestorPromise, updateTeamPromise, updateTransactionPromise]);

    return helpers.createResponse(200, {
        message: "Investment successful"
    });

}

// WIP
export const userStatus = async (event, ctx, callback) => {
    /*
    Responsible for:
    - Fetching user current balance
    - Fetching user's stake in other teams
    */

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
        userId: {
            required: true,
            type: "string"
        }
    });

    const user = await db.getOne(data.userId, USER_REGISTRATIONS_TABLE, {
        "eventID;year": "kickstart;2025"
    });

    if (!user) {
        return helpers.createResponse(400, {
            message: "User not found or not registered for event"
        });
    }

    const userInvestments = await db.scan(INVESTMENTS_TABLE, {
        FilterExpression: "#investorId = :investorId",
        ExpressionAttributeNames: {
            "#investorId": "investorId"
        },
        ExpressionAttributeValues: {
            ":investorId": data.userId
        }
    });

    // Aggregate user's stakes per team
    const stakes = userInvestments.reduce((accumulatedStakes, investment) => {
        if (!accumulatedStakes[investment.teamId]) {
            accumulatedStakes[investment.teamId] = 0;
        }

        // Add the investment amount to the team's stake
        accumulatedStakes[investment.teamId] += investment.amount;
        return accumulatedStakes;
    }, {});

    return helpers.createResponse(200, {
        balance: user.balance,
        stakes
    });
}

// WIP
export const teamStatus = async (event, ctx, callback) => {
    /*
    Responsible for:
    - Fetching team's current funding
    - Fetching all individual investments with comments
    */

    const data = JSON.parse(event.body);

    helpers.checkPayloadProps(data, {
        teamId: {
            required: true,
            type: "string"
        }
    });

    const team = await db.getOne(data.teamId, TEAMS_TABLE, {
        "eventID;year": "kickstart;2025"
    });

    if (!team) {
        return helpers.createResponse(400, {
            message: "Team not found for event"
        });
    }

    // Scan all investments made into this team
    const teamInvestments = await db.scan(INVESTMENTS_TABLE, {
        FilterExpression: "#teamId = :teamId",
        ExpressionAttributeNames: {
            "#teamId": "teamId"
        },
        ExpressionAttributeValues: {
            ":teamId": data.teamId
        }
    });

    return helpers.createResponse(200, {
        funding: team.funding,
        investments: teamInvestments // each entry includes comment, investorId, investorName, amount
    });
}
    