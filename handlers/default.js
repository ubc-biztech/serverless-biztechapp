'use strict';

const helpers = require('./helpers');

module.exports.hello = async () => {

  return helpers.createResponse(200, {
    message: 'Yeet!'
  });

};
