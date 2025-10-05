import { scan } from "../../lib/db.js";
import { AUDIT_TABLE } from "../../constants/tables.js";

export const getAuditLogs = async () => {
  const result = await scan(AUDIT_TABLE, {}, null);
  const sortedLogs = result.Items.sort((a, b) => 
    new Date(b.timestamp) - new Date(a.timestamp)
  );
  
  return {
    statusCode: 200,
    body: JSON.stringify(sortedLogs)
  };
};
