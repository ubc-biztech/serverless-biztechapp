import db from "../lib/db.js";
import docClient from "../lib/docClient.js";
import {
  USERS_TABLE
} from "../constants/tables.js";

const reset = async () => {
  const members = await db.scan(USERS_TABLE, {
    FilterExpression: "isMember <> :isMemberValue",
    ExpressionAttributeValues: {
      ":isMemberValue": false
    }
  });
  members.forEach((member) => {
    const paramsUpdate = {
      TableName: USERS_TABLE,
      Key: {
        id: member.id
      },
      UpdateExpression: "set isMember = :isMember",
      ExpressionAttributeValues: {
        ":isMember": false,
      }
    };
    docClient.update(paramsUpdate, (errUpdate) => {
      if (errUpdate) console.error(errUpdate);
    });
  });
};
// reset()
