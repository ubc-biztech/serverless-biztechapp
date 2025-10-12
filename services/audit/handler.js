import db from "../../lib/db.js";
import { AUDIT_TABLE } from "../../constants/tables.js";
import helpers from "../../lib/handlerHelpers.js";

export const getAuditLogs = async () => {
  const result = await db.scan(AUDIT_TABLE, {}, null);
  const sortedLogs = result.sort((a, b) =>
    new Date(b.timestamp) - new Date(a.timestamp)
  );

  return helpers.createResponse(200, sortedLogs);
};
