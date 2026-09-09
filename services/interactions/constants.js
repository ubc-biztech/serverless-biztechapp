// Event that new connections are stamped with for the live wall.
// Uses the same `eventID;year` key as the events/registrations tables.
// Prod and dev have different event records for MIS Night 2026.
export const CURRENT_EVENT =
  process.env.ENVIRONMENT === "PROD" ? "MISNight;2026" : "MIS_Night_2026;2026";

export const EXEC = "Exec";
export const PARTNER = "Partner";

export const QUEST_TOTAL_CONNECTIONS = "QUEST_TOTAL_CONNECTIONS";
export const QUEST_CONNECT_ONE = "QUEST_CONNECT_ONE";
export const QUEST_SNACK = "QUEST_SNACK";
export const QUEST_STARTUP = "QUEST_STARTUP";
export const QUEST_BIGTECH = "QUEST_BIGTECH";
export const QUEST_WORKSHOP = "QUEST_WORKSHOP";
export const QUEST_PHOTOBOOTH = "QUEST_PHOTOBOOTH";
export const QUEST_CONNECT_FOUR = "QUEST_CONNECT_FOUR";
export const QUEST_BT_BOOTH_H = "QUEST_BT_BOOTH_H";
export const QUEST_CONNECT_TEN_H = "QUEST_CONNECT_TEN_H";
export const QUEST_CONNECT_EXEC_H = "QUEST_CONNECT_EXEC_H";
export const QUEST_WORKSHOP_TWO_PARTICIPANT = "QUEST_WORKSHOP_TWO_PARTICIPANT";

export const WORKSHOP_TWO = "WORKSHOP_TWO";
export const WORKSHOP_TWO_PARTICIPANT = "WORKSHOP_TWO_PARTICIPANT";

export const BIGTECH = [
  "amazon",
  "aws",
  "axonify",
  "centrefordigitalmedia",
  "deloitte",
  "electronicarts",
  "google",
  "googlecloud",
  "instacart",
  "kpmg",
  "linusmediagroup",
  "mastercard",
  "mckinseycompany",
  "meta",
  "microsoft",
  "oracle",
  "pwc",
  "rbc",
  "samsungelectronics",
  "sap",
  "shopify",
  "slack",
  "spotify",
  "stripe",
  "telus",
  "vancity",
  "wealthsimple"
];
export const STARTUPS = [
  "futurpreneur",
  "internalautomations",
  "redpilllabs",
  "techcareernorth",
  "xpressselect",
  "wonsulting",
  "thecreativesolution",
  "interninsider"
];
export const PHOTOBOOTH = "PHOTO";
