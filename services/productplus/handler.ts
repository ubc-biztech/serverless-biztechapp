import { Access, protect } from "../../lib/auth";
import {
  ConfigValidationError,
  configResponse,
  getConfigRecord,
  notImplemented,
  parseConfigBody,
  saveConfig
} from "./helpers";
import response from "../../lib/responseHelpers";

// Submission routes remain scaffolded until membership, persistence, and S3
// operations are implemented. Admin config routes below are implemented.
export const getSubmission = protect(Access.USER, async () =>
  notImplemented("GET /productplus/submissions")
);

export const createUpload = protect(Access.USER, async () =>
  notImplemented("POST /productplus/submissions/upload")
);

export const putSubmission = protect(Access.USER, async () =>
  notImplemented("PUT /productplus/submissions")
);

export const getConfig = protect(Access.ADMIN, async () => {
  try {
    const config = await getConfigRecord();
    if (!config) {
      return response.send(404, { message: "Product Plus configuration has not been set." });
    }
    return response.ok(configResponse(config));
  } catch (error) {
    console.error("Failed to load Product Plus config:", error);
    return response.send(500, { message: "Unable to load Product Plus configuration." });
  }
});

export const putConfig = protect(Access.ADMIN, async (event) => {
  try {
    const config = parseConfigBody(event.body, event.isBase64Encoded);
    return response.ok(await saveConfig(config));
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      return response.badRequest(error.message);
    }
    console.error("Failed to save Product Plus config:", error);
    return response.send(500, { message: "Unable to save Product Plus configuration." });
  }
});
