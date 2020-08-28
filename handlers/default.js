'use strict';

const helpers = require('./helpers');

module.exports.hello = async (event, ctx, callback) => {

  return helpers.createResponse(200, {
    message: 'Yeet!'
  });

};
