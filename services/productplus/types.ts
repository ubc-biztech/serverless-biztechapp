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

/** Keys shared by submission records and the reserved config row. */
export type SubmissionKey = {
  event_key: string; // eventid;year
  team_code: string; // Six-digit string for teams; "config" for configuration.
};

/** Stored rubric shape shared with the judging workflow. */
export type Rubric = {
  judge_user_id: string;
  scores: [number, number, number, number, number];
  comments: string;
};

/** Stored submission. Updates must preserve judging and voting attributes. */
export type SubmissionRecord = Omit<Submission, "prd_view_url"> &
  SubmissionKey & {
    graded_submissions: Rubric[];
    upvotes: number;
    downvotes: number;
    voter_ids?: Set<string>; // Omit until the first vote; never store an empty set.
    version: number; // Concurrency guard, not submission version history.
  };

/** Stored in the submissions table under (event_key, "config"). */
export type ConfigRecord = Config & {
  event_key: string;
  team_code: "config";
  version: number;
  updated_at: string;
};

export type ProductPlusRecord = SubmissionRecord | ConfigRecord;

export type UploadKey = {
  prd_path: string;
};

export type UploadStatus =
  | "pending"
  | "referenced"
  | "replaced"
  | "deleting"
  | "deleted";

/** All timestamps are canonical UTC ISO 8601 strings, including cleanup_after. */
export type UploadRecord = UploadKey & {
  event_key: string;
  team_code: string;
  upload_id: string;
  content_type: "application/pdf";
  status: UploadStatus;
  created_at: string;
  updated_at: string;
  upload_expires_at: string;
  cleanup_after?: string; // Absent for referenced and fully deleted uploads.
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
