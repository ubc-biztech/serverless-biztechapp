import { JUDGING_EVENTS_TABLE } from "../../constants/tables.js";

export { JUDGING_EVENTS_TABLE };

/**
 * One partition per event in biztechJudging: id = "<eventID>;<year>" (the repo's usual
 * composite event key), sk = one of the prefixes below + the record id.
 */
export const eventKey = (eventID: string, year: number) => `${eventID};${year}`;

export const SK = {
  SETTINGS: "SETTINGS",
  RUBRIC: "RUBRIC",
  TEAM: "TEAM#",
  JUDGE: "JUDGE#",
  REVIEW: "REVIEW#",
  LINK: "LINK#",
  CODE: "CODE#"
} as const;

/** Login codes: XXXX-XXXX from an alphabet without 0/O/1/I. */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
