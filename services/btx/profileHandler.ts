import { Access, protect } from "../../lib/auth";
import response from "../../lib/responseHelpers";
import db from "../../lib/db.js";
import { CompanyProfileValidationError, toCompanyProfile } from "./companyProfile";
import {
  CompanyProfileAccessError,
  buildCompanyProfileSave,
  getCompanyProfilePermissions,
  loadCompanyProfileContext,
} from "./companyProfileAccess";

export const getCompanyProfile = protect(Access.USER, async (event) => {
  try {
    const projectId = event.pathParameters?.projectId;
    if (typeof projectId !== "string" || !projectId.trim()) {
      return response.badRequest("Provide a company projectId in the URL.");
    }
    const context = await loadCompanyProfileContext(projectId, event.auth!.email);
    const result = response.ok({
      projectId: context.company.projectId,
      ...toCompanyProfile(context.company),
      ...getCompanyProfilePermissions(context),
    });
    result.headers = { ...result.headers, "Cache-Control": "private, no-store" };
    return result;
  } catch (error) {
    if (error instanceof CompanyProfileAccessError) {
      return response.send(error.statusCode, { message: error.message });
    }
    console.error("Failed to load BTX company profile:", error instanceof Error ? error.name : "UnknownError");
    return response.send(500, { message: "Unable to load the company profile." });
  }
});

export const patchCompanyProfile = protect(Access.USER, async (event) => {
  try {
    const projectId = event.pathParameters?.projectId;
    if (typeof projectId !== "string" || !projectId.trim()) {
      return response.badRequest("Provide a company projectId in the URL.");
    }
    let value: unknown;
    try {
      value = JSON.parse(event.body ?? "");
    } catch {
      return response.badRequest("Provide a valid JSON company profile.");
    }
    const context = await loadCompanyProfileContext(projectId, event.auth!.email);
    const operations = buildCompanyProfileSave(context, value);
    await db.txn(...operations);
    return response.noContent();
  } catch (error) {
    if (error instanceof CompanyProfileValidationError) {
      return response.badRequest(error.message);
    }
    if (error instanceof CompanyProfileAccessError) {
      return response.send(error.statusCode, { message: error.message });
    }
    if (db.isConflict(error)) {
      return response.send(409, { message: "Company or permissions changed. Reload the profile and try again." });
    }
    console.error("Failed to save BTX company profile:", error instanceof Error ? error.name : "UnknownError");
    return response.send(500, { message: "Unable to save the company profile." });
  }
});
