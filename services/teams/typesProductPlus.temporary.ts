// TEMP replace with Elijah's ;ater
export type Team = {
  team_code: string;
  team_name: string;
  leader_user_id: string;
  members: {
    user_id: string;
    name: string;
  }[];
};

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

export type Rubric = {
  judge_user_id: string;
  scores: number[];
  comments: string;
};

export type RankedSubmission = {
  team_code: string;
  team_name: string;
  rubric_average: number | null;
  rubric_count: number;
  upvotes: number;
  downvotes: number;
  audience_score: number;
};