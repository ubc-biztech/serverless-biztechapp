import { isSupportedTwitterURL, isSupportedYouTubeURL } from "../../lib/urls";
import helpers from "../../lib/handlerHelpers";
import type { PayloadCheckRule } from "../../lib/types";

/** Editable company attributes; older stored companies may lack twitterURL. */
export interface CompanyProfile {
  companyName: string;
  blurb: string;
  youtubeURL: string;
  twitterURL?: string;
}

/** PATCH supplies only changed fields, rather than replacing the entire profile. */
export type CompanyProfilePatch = Partial<CompanyProfile>;

export const COMPANY_PROFILE_LIMITS = {
  companyName: 100,
  blurb: 2_000,
  youtubeURL: 2_048,
  twitterURL: 2_048,
} as const;

export class CompanyProfileValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CompanyProfileValidationError";
  }
}

function stringRule(
  field: keyof CompanyProfile,
  validate?: (value: string) => string | undefined,
): PayloadCheckRule {
  return {
    type: "string",
    validate: value => {
      const text = value as string;
      if (text.length > COMPANY_PROFILE_LIMITS[field]) {
        return `${field} must be at most ${COMPANY_PROFILE_LIMITS[field]} characters.`;
      }
      return validate?.(text);
    },
  };
}

const COMPANY_PROFILE_RULES = {
  companyName: stringRule("companyName", value => value ? undefined : "companyName must not be blank."),
  blurb: stringRule("blurb"),
  youtubeURL: stringRule("youtubeURL", value => value && !isSupportedYouTubeURL(value)
    ? "Provide a supported HTTPS YouTube video URL." : undefined),
  twitterURL: stringRule("twitterURL", value => value && !isSupportedTwitterURL(value)
    ? "Provide an HTTPS Twitter/X link." : undefined),
};

export function validateCompanyProfilePatch(value: unknown): CompanyProfilePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CompanyProfileValidationError("Provide a company profile object.");
  }
  const fields = Object.keys(value);
  if (fields.length === 0) {
    throw new CompanyProfileValidationError("Provide at least one company profile field.");
  }
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(COMPANY_PROFILE_RULES, field)) {
      throw new CompanyProfileValidationError(`Unknown or protected company field: ${field}.`);
    }
    const input = (value as Record<string, unknown>)[field];
    patch[field] = typeof input === "string" ? input.trim() : input;
  }
  helpers.checkPayloadProps(patch, COMPANY_PROFILE_RULES, message => new CompanyProfileValidationError(message));
  return patch as CompanyProfilePatch;
}

/** Explicit projection keeps market/ownership fields out of the editable profile. */
export function toCompanyProfile(company: CompanyProfile): Required<CompanyProfile> {
  return {
    companyName: company.companyName,
    blurb: company.blurb,
    youtubeURL: company.youtubeURL,
    twitterURL: company.twitterURL ?? "",
  };
}

/** Checks the required fields, not IPO readiness or the optional Twitter link. */
export function isCompanyProfileComplete(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const profile = value as Record<string, unknown>;
  try {
    const required = validateCompanyProfilePatch({
      companyName: profile.companyName,
      blurb: profile.blurb,
      youtubeURL: profile.youtubeURL,
    });
    return Boolean(required.companyName && required.blurb && required.youtubeURL);
  } catch (error) {
    if (error instanceof CompanyProfileValidationError) return false;
    throw error;
  }
}
