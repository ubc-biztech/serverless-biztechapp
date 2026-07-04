import type { APIGatewayResponse } from "../../lib/types";

/** Team item stored in biztechTeams. */
export interface TeamRecord {
  id: string;
  teamName: string;
  "eventID;year": string;
  memberIDs: string[];
  memberNames?: string[];
  scannedQRs: string[];
  points: number;
  pointsSpent: number;
  transactions: string[];
  inventory: string[];
  submission: string;
  metadata: Record<string, unknown>;
  funding?: number;
  [key: string]: unknown;
}

/** New team payload written in makeTeam. */
export type NewTeamRecord = TeamRecord;

export interface ScoreMetrics {
  metric1: number;
  metric2: number;
  metric3: number;
  metric4: number;
  metric5: number;
}

export interface ScoreAverage extends ScoreMetrics {}

export interface JudgeScore extends ScoreMetrics {
  team: string;
  teamName: string;
  judge: string;
}

export interface NormalizedScore extends JudgeScore {
  originalScores: JudgeScore[];
}

export interface JudgeUpdateResult {
  judgeID: string;
  status: string;
  error?: string;
}

export interface TeamActionResult {
  success: boolean;
  message: string;
  memberIDs?: string[];
  teamName?: string;
}

export interface UpdateTeamPointsBody {
  user_id: string;
  eventID: string;
  year: number;
  change_points: number;
  [key: string]: unknown;
}

export interface LeaveTeamBody {
  memberID: string;
  eventID: string;
  year: number;
  [key: string]: unknown;
}

export interface JoinTeamBody {
  memberID: string;
  eventID: string;
  year: number;
  teamID: string;
  [key: string]: unknown;
}

export interface MakeTeamBody {
  team_name: string;
  eventID: string;
  year: number;
  memberIDs: string[];
  [key: string]: unknown;
}

export interface GetTeamFromUserIDBody {
  user_id: string;
  eventID: string;
  year: number;
  [key: string]: unknown;
}

export interface ChangeTeamNameBody {
  user_id: string;
  eventID: string;
  year: number;
  team_name: string;
  [key: string]: unknown;
}

export interface AddQRScanBody {
  user_id: string;
  qr_code_id: string;
  eventID: string;
  year: number;
  points?: number;
  [key: string]: unknown;
}

export interface AddMultipleQuestionsBody {
  user_id: string;
  answered_questions: string[];
  eventID: string;
  year: number;
  points?: number;
  [key: string]: unknown;
}

export interface CheckQRScannedBody {
  user_id: string;
  qr_code_id: string;
  eventID: string;
  year: number;
  [key: string]: unknown;
}

export interface CreateJudgeSubmissionsBody {
  teamID: string;
  judgeID: string;
  eventID: string;
  year: number;
  scores: ScoreMetrics;
  feedback?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface UpdateJudgeSubmissionBody {
  teamID: string;
  round: string | number;
  judgeID: string;
  scores?: ScoreMetrics;
  feedback?: string | Record<string, unknown>;
  teamName?: string;
  createdAt?: string;
  judgeName?: string;
  [key: string]: unknown;
}

export interface UpdateCurrentTeamForJudgeBody {
  judgeIDs: string[];
  [key: string]: unknown;
}

export interface FeedbackRecord {
  id: string;
  "teamID;round": string;
  teamID?: string;
  teamName?: string;
  judgeName?: string;
  scores?: ScoreMetrics;
  feedback?: Record<string, unknown> | string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface NormalizedRoundScoreResult {
  teamID: string;
  teamName: string;
  zScoreWeighted: number;
  judges: string[];
  originalResponses: Array<{ judge: string } & ScoreMetrics>;
}

export interface JudgeRegistrationRecord {
  isPartner?: boolean;
  fname?: string;
  [key: string]: unknown;
}

export interface RoundRecord {
  id?: string;
  currentTeam: string;
  [key: string]: unknown;
}

export interface TeamsHelpers {
  _getTeamFromUserRegistration(
    userID: string,
    eventID: string,
    year: number,
  ): Promise<TeamRecord | null>;
  updateJudgeTeam(
    judgeIDs: string[],
    teamID: string,
  ): Promise<APIGatewayResponse>;
  _putTeam(team: TeamRecord, createNew: boolean): Promise<unknown>;
  leaveTeam(
    memberID: string,
    eventID: string,
    year: number,
  ): Promise<TeamActionResult>;
  joinTeam(
    memberID: string,
    eventID: string,
    year: number,
    teamID: string,
  ): Promise<TeamActionResult>;
  makeTeam(
    team_name: string,
    eventID: string,
    year: number,
    memberIDs: string[],
  ): Promise<NewTeamRecord>;
  checkQRScanned(
    user_id: string,
    qr_code_id: string,
    eventID: string,
    year: number,
  ): Promise<boolean>;
  addQRScan(
    user_id: string,
    qr_code_id: string,
    eventID: string,
    year: number,
    points: number,
  ): Promise<unknown>;
  addQuestions(
    user_id: string,
    questions: string[],
    eventID: string,
    year: number,
    pointsPerQuestion: number,
  ): Promise<unknown>;
  changeTeamName(
    user_id: string,
    eventID: string,
    year: number,
    team_name: string,
  ): Promise<unknown>;
}