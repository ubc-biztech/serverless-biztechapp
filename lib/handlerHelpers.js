export default {
  createResponse: function (statusCode, body) {
    const response = {
      statusCode,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true
      },
      // helps stringify Error objects as well
      body: (body && body.stack && body.message)
        ? JSON.stringify(body, Object.getOwnPropertyNames(body))
        : JSON.stringify(body)
    };
    return response;
  },

  missingIdQueryResponse: function (type) {
    return this.createResponse(400, {
      message: `A(n) ${type} id was not provided. Check query params`
    });
  },

  missingPathParamResponse: function (type, paramName) {
    return this.createResponse(400, {
      message: `A(n) ${paramName} path parameter was not provided for this ${type}. Check path params`
    });
  },

  notFoundResponse: function(type = null, id = null, secondaryKey = null) {
    let message;

    if(type && id) {
      message = secondaryKey ?
        `${type} with id '${id}' and secondaryKey '${secondaryKey}' could not be found. Make sure you have provided them correctly.`:
        `${type} with id '${id}' could not be found. Make sure you have provided the correct id.`;
    } else {
      message = "No entries found";
    }

    return this.createResponse(404, {
      message
    });
  },

  duplicateResponse: function(prop, data) {
    const response = this.createResponse(409, {
      message: `A database entry with the same '${prop}' already exists!`,
      data: data
    });
    console.error("DUPLICATE ERROR", response);
    return response;
  },

  inputError: function(message, data) {
    const response = this.createResponse(406, {
      message: message,
      data: data
    });
    console.error("INPUT ERROR", response);
    return response;
  },

  /**
   * Check if the object passed matches the criteria
   * @param {*} payload - the object 
   * @param {*} check  - object containing the criteria for each property keyed by the property name
   * The object criteria accepts the following properties:
   * {
   *    required: <boolean>,
   *    type: <string>
   * }
   */
  checkPayloadProps: function(payload, check = {
  }) {
    try {
      const criteria = Object.entries(check);

      criteria.forEach(([key, crit]) => {
        // check if property exists
        if(crit.required && !payload[key] && payload[key] !== false) {
          throw `'${key}' is missing from the request body`;
        }
        // check for the property's type
        if(crit.type && payload[key] && typeof payload[key] !== crit.type) {
          throw `'${key}' in the request body is invalid, expected type '${crit.type}' but got '${typeof payload[key]}'`;
        }
      });
    } catch(errMsg) {
      throw this.inputError(errMsg, payload);
    }
  },

};
