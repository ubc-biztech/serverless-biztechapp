/** API response. prd_view_url is generated when responding, never stored. */
export type Submission = {
  team_code: string;
  team_name: string;
  project_title: string | null;
  member_names: string[];
  video_url: string;
  prd_path: string;
  prd_filename: string | null;
  prd_view_url: string;
  submitted_at: string;
  updated_at: string;
};

export type Config = {
  submission_deadline: string;
  voting_deadline: string;
};

/** Workflow 1 EventTeamRecord shape stored in biztechTeams. */
export type TeamRecord = {
  "id": string; // Six-digit team code, retaining leading zeros.
  "eventID;year": string;
  team_name: string;
  leader_user_id: string;
  member_ids: Set<string>;
};

/** Workflow 1 stores the user's current six-digit team code in registration.teamID. */
export type RegistrationRecord = {
  "id": string; // Verified email.
  "eventID;year": string;
  teamID?: string;
};

/** Keys shared by submission records and the reserved config row. */
export type SubmissionKey = {
  event_key: string; // eventid;year
  team_code: string; // Six-digit string for teams; "config" for configuration.
};

/** Stored rubric shape shared with the judging workflow. */
export type Rubric = {
  judge_user_id: string;
  scores: [number, number, number, number, number]; // Finite scores in [0, 10], in the judging workflow's criterion order.
  comments: [string, string, string, string, string]; // comments[i] corresponds to scores[i].
};

/** Stored submission. Updates must preserve judging and voting attributes. */
export type SubmissionRecord = Omit<
  Submission,
  "prd_view_url" | "project_title" | "prd_filename"
> &
  SubmissionKey & {
    project_title?: string | null; // Older submissions may not have these fields.
    prd_filename?: string | null;
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
  "pending" | "promoting" | "referenced" | "replaced" | "deleting" | "deleted";

/** Tracking stays after file removal so interrupted operations can be reconciled. */
export type UploadRecord = UploadKey & {
  event_key: string;
  team_code: string;
  upload_id: string;
  content_type: "application/pdf";
  prd_filename?: string; // Original browser filename; never used as an S3 key.
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

/** Judge comments shown to the team. Scores stay private to judges. */
export type JudgeFeedback = Pick<Rubric, "judge_user_id" | "comments">;

export type GetSubmissionResponse = {
  submission: Submission | null;
  submission_deadline: string;
  can_edit: boolean;
  feedback: JudgeFeedback[]; // Only judges who left at least one comment.
};

export type UploadSubmissionBody = {
  content_type: "application/pdf";
  prd_filename?: string;
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
> & {
  project_title?: string;
};
