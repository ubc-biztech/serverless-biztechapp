import helpers from '../../lib/handlerHelpers';
import db from '../../lib/db';
const { MEMBERS2022_TABLE } = require('../../constants/tables');

export const getAll = async(event, ctx, callback) => {

  try {

    // scan the table
    const members = await db.scan(MEMBERS2022_TABLE);

    // re-organize the response
    let response = {};
    if (members !== null) response = helpers.createResponse(200, members);

    // return the response object
    callback(null, response);
    return null;

  } catch (err) {

    callback(null, err);
    return null;

  }

};
