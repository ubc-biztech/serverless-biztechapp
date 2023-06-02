import {
  v4 as uuidv4
} from "uuid";
import helpers from "../../lib/handlerHelpers";
import db from "../../lib/db";
import {
  isEmpty
} from "../../lib/utils";
import {
  TRANSACTIONS_TABLE, USERS_TABLE
} from "../../constants/tables";

export const getAll = async (event, ctx, callback) => {
  try {
    const filters = {
    };

    // check if a query was provided
    const userId = event && event.queryStringParameters && event.queryStringParameters.userId;

    // construct the filter params if needed
    if (userId) {
      filters.FilterExpression = "userId = :query";
      filters.ExpressionAttributeValues = {
        ":query": parseInt(userId, 10)
      };
    }

    // scan the table
    const transaction = await db.scan(TRANSACTIONS_TABLE, filters);

    let items = {
    };

    // re-organize the response
    if(userId && transaction !== null) {
      items.count = transaction.length;
      items.transactions = transaction;
      items.totalCredits = transaction.reduce((accumulator, item) => accumulator + item.credits, 0);
    }
    else if(userId) {
      items.count = 0;
      items.transactions = {
      };
      items.totalCredits = 0;
    }
    else if(transaction !== null) items = transaction;

    const response = helpers.createResponse(200, items);

    // return the response object
    callback(null, response);
    return null;
  } catch(err) {
    callback(null, err);
    return null;
  }
};

export const create = async (event, ctx, callback) => {
  try {
    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body);

    // check request body
    helpers.checkPayloadProps(data, {
      userId: {
        required: true,
        type: "number"
      },
      reason: {
        required: true,
        type: "string"
      },
      credits: {
        required: true,
        type: "number"
      },
    });

    // check that the user id exists
    const existingUser = await db.getOne(data.userId, USERS_TABLE);
    if(isEmpty(existingUser)) throw helpers.notFoundResponse("User", data.userId);

    // generate a random uuid for the transaction
    // if by some chance the uuid exists, generate another uuid until a unique one is created
    let existingTransaction = null;
    while(!data.id || !isEmpty(existingTransaction)) {
      data.id = uuidv4();
      existingTransaction = await db.getOne(data.id, TRANSACTIONS_TABLE);
    }

    // if credits is negative value, check if the user has enough credits
    if(data.credits < 0) {
      const userCredits = existingUser.credits || 0;
      // 202 means "accepted, but not acted upon"
      if(userCredits + data.credits < 0) throw helpers.createResponse(202, {
        message: "Transaction was not created because user does not have enough credits!"
      });
    }

    // construct the item object
    const item = {
      id: data.id,
      userId: data.userId,
      reason: data.reason,
      credits: data.credits,
      createdAt: timestamp
    };

    // do the magic
    const res = await db.create(item, TRANSACTIONS_TABLE);
    const response = helpers.createResponse(201, {
      message: "Transaction Created!",
      response: res,
      item
    });

    // return the response object
    callback(null, response);
    return null;
  } catch(err) {
    callback(null, err);
    return null;
  }
};
