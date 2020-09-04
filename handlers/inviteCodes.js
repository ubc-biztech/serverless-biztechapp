'use strict';
const helpers = require('./helpers');
const crypto = require('crypto');
const email = require('../utils/email');
const { USER_INVITE_CODES_TABLE } = require('../constants/tables');

module.exports.invite = async (event, ctx, callback) => {

  try {

    const data = JSON.parse(event.body);
    helpers.checkPayloadProps(data, {
      email: { required: true }
    });

    const id = crypto.randomBytes(20).toString('hex');
    const item = { id, email: data.email };

    const res = await helpers.create(item, USER_INVITE_CODES_TABLE);

    const msg = {
      to: data.email,
      templateId: 'd-198cfc5057914538af105ef469f51217',
      dynamic_template_data: {
        url: 'https://app.ubcbiztech.com/invite/'+id // TODO: Fix url format based on frontend implementation
      }
    };

    email.send(msg);

    const response = helpers.createResponse(200, {
      message: 'Invite code created & sent to ' + data.email,
      response: res
    });

    callback(null, response);
    return null;

  }
  catch(err) {

    console.error(err);
    callback(null, err);
    return null;

  }

};