import { isSupportedYouTubeURL } from "../../lib/youtube";

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

function isSupportedTwitterURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "m.twitter.com"].includes(url.hostname) &&
      url.pathname !== "/";
  } catch {
    return false;
  }
}

function validateField(field: keyof CompanyProfile, value: unknown): string {
  if (typeof value !== "string") {
    throw new CompanyProfileValidationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > COMPANY_PROFILE_LIMITS[field]) {
    throw new CompanyProfileValidationError(`${field} must be at most ${COMPANY_PROFILE_LIMITS[field]} characters.`);
  }
  if (field === "companyName" && !trimmed) {
    throw new CompanyProfileValidationError("companyName must not be blank.");
  }
  if (field === "youtubeURL" && trimmed && !isSupportedYouTubeURL(trimmed)) {
    throw new CompanyProfileValidationError("Provide a supported HTTPS YouTube video URL.");
  }
  if (field === "twitterURL" && trimmed && !isSupportedTwitterURL(trimmed)) {
    throw new CompanyProfileValidationError("Provide an HTTPS Twitter/X link.");
  }
  return trimmed;
}

/** Validate parsed request data. Authentication and lifecycle rules are separate. */
export function validateCompanyProfilePatch(value: unknown): CompanyProfilePatch {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CompanyProfileValidationError("Provide a company profile object.");
  }
  const fields = Object.keys(value);
  if (fields.length === 0) {
    throw new CompanyProfileValidationError("Provide at least one company profile field.");
  }
  const patch: CompanyProfilePatch = {};
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(COMPANY_PROFILE_LIMITS, field)) {
      throw new CompanyProfileValidationError(`Unknown or protected company field: ${field}.`);
    }
    const key = field as keyof CompanyProfile;
    patch[key] = validateField(key, (value as Record<string, unknown>)[key]);
  }
  return patch;
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
    for (const field of ["companyName", "blurb", "youtubeURL"] as const) {
      if (!validateField(field, profile[field])) return false;
    }
    return true;
  } catch (error) {
    if (error instanceof CompanyProfileValidationError) return false;
    throw error;
  }
}
