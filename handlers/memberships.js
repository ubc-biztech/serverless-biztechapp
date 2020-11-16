'use strict';
const helpers = require('./helpers');
const { MEMBERSHIPS_TABLE } = require('../constants/tables');

module.exports.getAll = async(event, ctx, callback) => {

    try {

        // scan the table
        const memberships = await helpers.scan(MEMBERSHIPS_TABLE);

        // re-organize the response
        let response = {};
        if (memberships !== null) response = helpers.createResponse(200, memberships);

        // return the response object
        callback(null, response);
        return null;

    } catch (err) {

        callback(null, err);
        return null;

    }

};
