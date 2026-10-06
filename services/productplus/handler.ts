import { Access, protect } from "../../lib/auth";
import {
  ConfigValidationError,
  configResponse,
  getConfigRecord,
  parseConfigBody,
  saveConfig,
  createPrdUpload,
  ProductPlusError,
  loadSubmission,
  saveSubmission,
  cleanupProductPlus
} from "./helpers";
import response from "../../lib/responseHelpers";
import type { CleanupTask } from "./types";

// IAM-only Lambda invocation. No HTTP route or recurring schedule is attached.
export const cleanup = (task: CleanupTask) => cleanupProductPlus(task);

export const getSubmission = protect(Access.USER, async (event) => {
  try {
    return response.ok(await loadSubmission(event.auth!.email));
  } catch (error) {
    if (error instanceof ProductPlusError) {
      return response.send(error.statusCode, { message: error.message });
    }

    console.error(
      "Failed to load Product Plus submission:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return response.send(500, {
      message: "Unable to load a Product Plus submission."
    });
  }
});

export const createUpload = protect(Access.USER, async (event) => {
  try {
    return response.ok(
      await createPrdUpload(
        event.auth!.email,
        event.body,
        event.isBase64Encoded
      )
    );
  } catch (error) {
    if (error instanceof ProductPlusError) {
      return response.send(error.statusCode, { message: error.message });
    }

    console.error(
      "Failed to create Product Plus upload URL:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return response.send(500, {
      message: "Unable to create a Product Plus upload URL."
    });
  }
});

export const putSubmission = protect(Access.USER, async (event) => {
  try {
    return response.ok(
      await saveSubmission(event.auth!.email, event.body, event.isBase64Encoded)
    );
  } catch (error) {
    if (error instanceof ProductPlusError) {
      return response.send(error.statusCode, { message: error.message });
    }

    console.error(
      "Failed to save Product Plus submission:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return response.send(500, {
      message: "Unable to save a Product Plus submission."
    });
  }
});

export const getConfig = protect(Access.ADMIN, async () => {
  try {
    const config = await getConfigRecord();

    if (!config) {
      return response.send(404, {
        message: "Product Plus configuration has not been set."
      });
    }

    return response.ok(configResponse(config));
  } catch (error) {
    console.error(
      "Failed to load Product Plus config:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return response.send(500, {
      message: "Unable to load Product Plus configuration."
    });
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

    console.error(
      "Failed to save Product Plus config:",
      error instanceof Error ? error.name : "UnknownError"
    );

    return response.send(500, {
      message: "Unable to save Product Plus configuration."
    });
  }
});
