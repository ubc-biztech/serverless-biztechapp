import type { ResponseHelpers } from "./types";

/* framework agnostic http response helper for handlers */

const responseHelpers: ResponseHelpers = {
  send(statusCode, body) {
    return {
      statusCode,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Credentials": true
      },
      body:
        body && typeof body === "object" && "stack" in body && "message" in body
          ? JSON.stringify(body, Object.getOwnPropertyNames(body))
          : JSON.stringify(body)
    };
  },

  ok(data) {
    return this.send(200, data);
  },

  created(data) {
    return this.send(201, data);
  },

  noContent() {
    return this.send(204);
  },

  badRequest(message, data = "") {
    return this.send(400, { message, data });
  },

  unauthorized(message) {
    return this.send(403, { message });
  },

  notFound(type, id, secondaryKey) {
    let message = "No entries found";

    if (type && id) {
      message = secondaryKey
        ? `${type} '${id}' with secondary key '${secondaryKey}' not found`
        : `${type} '${id}' not found`;
    }

    return this.send(404, { message });
  },

  notAcceptable(message: string, data: unknown) {
    const res = this.send(406, {
      message,
      data
    });
    console.error("INPUT ERROR", res);
    return res;
  },

  conflict(prop, data) {
    const res = this.send(409, {
      message: `Duplicate '${prop}'`,
      data
    });
    console.error("CONFLICT", res);
    return res;
  },

  error(message, error) {
    const res = this.send(500, { message, error });
    console.error("ERROR", error);
    return res
  }
};

export default responseHelpers;
