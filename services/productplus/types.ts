/** API response. prd_view_url is generated when responding, never stored. */
export type Submission = {
  team_code: string;
  team_name: string;
  member_names: string[];
  video_url: string;
  prd_path: string;
  prd_view_url: string;
  submitted_at: string;
  updated_at: string;
};

export type Config = {
  submission_deadline: string;
  voting_deadline: string;
};

/** Fields Product Plus reads from biztechTeams. Member identifiers are verified emails. */
export type TeamRecord = {
  id: string; // Six-digit team code, retaining leading zeros.
  "eventID;year": string;
  memberIDs: string[];
};

/** The event registration stores the user's current team code; teamID is not used. */
export type RegistrationRecord = {
  id: string; // Verified email.
  "eventID;year": string;
  team_code?: string;
};

/** Keys shared by submission records and the reserved config row. */
export type SubmissionKey = {
  event_key: string; // eventid;year
  team_code: string; // Six-digit string for teams; "config" for configuration.
};

/** Stored rubric shape shared with the judging workflow. */
export type Rubric = {
  judge_user_id: string;
  scores: number[]; // The judging workflow validates five scores and their ranges.
  comments: string;
};

/** Stored submission. Updates must preserve judging and voting attributes. */
export type SubmissionRecord = Omit<Submission, "prd_view_url"> &
  SubmissionKey & {
    graded_submissions: Rubric[];
    upvotes: number;
    downvotes: number;
    voter_ids?: Set<string>; // Omit until the first vote; never store an empty set.
  };

/** Stored in the submissions table under (event_key, "config"). */
export type ConfigRecord = Config & {
  event_key: string;
  team_code: "config";
  updated_at: string;
};

export type ProductPlusRecord = SubmissionRecord | ConfigRecord;

export type UploadKey = {
  prd_path: string;
};

export type UploadStatus =
  | "pending"
  | "promoting"
  | "referenced"
  | "replaced"
  | "deleting"
  | "deleted";

/** Tracking stays after file removal so interrupted operations can be reconciled. */
export type UploadRecord = UploadKey & {
  event_key: string;
  team_code: string;
  upload_id: string;
  content_type: "application/pdf";
  status: UploadStatus;
  created_at: string;
  updated_at: string;
  upload_expires_at: string;
  permanent_path?: string;
  promotion_token?: string;
};

/** Private Lambda invocation; no task is exposed through an HTTP route. */
export type CleanupTask =
  | {
      internalTask: "retire_upload";
      payload: { event_key: string; prd_path: string };
    }
  | {
      internalTask: "team_deleted";
      payload: { event_key: string; team_code: string };
    };

export type GetSubmissionResponse = {
  submission: Submission | null;
  submission_deadline: string;
  can_edit: boolean;
};

export type UploadSubmissionBody = {
  content_type: "application/pdf";
};

export type UploadSubmissionResponse = {
  upload_url: string;
  upload_method: "PUT";
  upload_headers: Record<string, string>;
  prd_path: string;
};

export type PutSubmissionBody = Pick<
  Submission,
  "team_name" | "member_names" | "video_url" | "prd_path"
>;
