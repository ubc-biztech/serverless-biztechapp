/** Submission contract aligned with WF2 (services/productplus/types.ts). */
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

export type SubmissionKey = {
  event_key: string; // eventid;year
  team_code: string; // Six-digit string for teams; "config" for configuration.
};

export type SubmissionRecord = Omit<Submission, "prd_view_url" | "project_title" | "prd_filename"> &
  SubmissionKey & {
    project_title?: string | null;
    prd_filename?: string | null;
    graded_submissions: Rubric[];
    upvotes: number;
    downvotes: number;
    voter_ids?: Set<string>; // Omit until the first vote; never store an empty set.
  };

export type Config = {
  submission_deadline: string;
  voting_deadline: string;
};

export type Rubric = {
  judge_user_id: string;
  scores: [number, number, number, number, number]; // Finite scores in [0, 10], in PRODUCT_PLUS_RUBRIC_CRITERIA order.
  comments: [string, string, string, string, string]; // comments[i] corresponds to scores[i].
};

export type RankedSubmission = {
  team_code: string;
  team_name: string;
  rubric_average: number | null; // Mean of judges' weighted totals out of 100; null if ungraded.
  rubric_count: number;
  upvotes: number;
  downvotes: number;
  audience_score: number;
};

/** Admin detail can display a draft before its PDF exists. */
export type AdminSubmission = Omit<Submission, "prd_view_url"> & {
  prd_view_url: string | null;
};
