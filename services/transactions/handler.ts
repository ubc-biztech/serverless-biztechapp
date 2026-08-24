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
import type {
  APIGatewayEvent, LambdaCallback, LambdaContext, ScanFilters
} from "../../lib/types";

export const getAll = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    const filters: ScanFilters = {
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

    // `items` is either a summary object or the raw scan array, depending on
    // whether `userId` was supplied.
    let items: any = {
    };

    // re-organize the response
    if(userId && transaction !== null) {
      items.count = transaction.length;
      items.transactions = transaction;
      items.totalCredits = transaction.reduce((accumulator: number, item: any) => accumulator + item.credits, 0);
    }
    else if(userId) {
      items.count = 0;
      items.transactions = {
      };
      items.totalCredits = 0;
    }
    else if(transaction !== null) items = transaction;

    const response = helpers.createResponse(200, items);

    return response;
  } catch(err) {
    return helpers.createResponse(500, { message: (err as { message?: unknown }).message || err });
  }
};

export const create = async (event: APIGatewayEvent, ctx: LambdaContext, callback: LambdaCallback) => {
  try {
    const timestamp = new Date().getTime();
    const data = JSON.parse(event.body as string);

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
      // Non-null assertion only: the `isEmpty` guard above already returned for
      // a null user, but TypeScript cannot narrow through it.
      const userCredits = existingUser!.credits || 0;
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

    return response;
  } catch(err) {
    return helpers.createResponse(500, { message: (err as { message?: unknown }).message || err });
  }
};
