'use strict';

const helpers = require('./helpers')

module.exports.hello = () => {
  return helpers.createResponse(200, {
    message: 'Yeet!'
  })
};
