// Shared identity for this edition; other Kickstart years keep their own policy.
export const KICKSTART_EVENT_ID = "kickstart";
export const KICKSTART_EVENT_YEAR = 2027;
export const KICKSTART_EVENT_KEY = `${KICKSTART_EVENT_ID};${KICKSTART_EVENT_YEAR}`;

export const KICKSTART_TEAM_REGISTRATION_STATUSES = [
  "acceptedComplete",
  "checkedIn",
] as const;
