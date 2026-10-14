import db from "../../lib/db.js";
import res from "../../lib/responseHelpers";
import helpers from "../../lib/handlerHelpers";
import { Access, protect } from "../../lib/auth";
import {
  getEventKey,
  getVotingConfig,
  querySubmissions,
  tableName,
  isVotingOpen,
  submissionResponse
} from "./helpersProductPlus";
import {
  Submission,
  Rubric,
  RankedSubmission,
  SubmissionRecord
} from "./typesProductPlus";
import { PRODUCT_PLUS_RUBRIC_SCORE_COUNT } from "./constants";
import { handle } from "./helpersJudging";
import { AuthEvent } from "../../lib/auth";

export const audienceSubmissions = protect(
  Access.PUBLIC,
  handle(async (event) => {
    const user_id = (event as AuthEvent).auth?.email;
    const event_key = getEventKey();
    const config = await getVotingConfig(event_key);
    // Submissions remain private while teams can still edit their entries.
    const rows = (Date.now() < Date.parse(config.submission_deadline)
      ? []
      : await querySubmissions(
          event_key,
          "team_code, team_name, video_url, voter_ids",
          true
        )) as (Pick<
      Submission,
      "team_code" | "team_name" | "video_url"
    > & { voter_ids?: Set<string> })[];

    const submissions = rows.map((row) => ({
      team_code: row.team_code,
      team_name: row.team_name,
      video_url: row.video_url,
      has_voted: user_id ? (row.voter_ids?.has(user_id) ?? false) : null
    }));

    for (let i = submissions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [submissions[i], submissions[j]] = [submissions[j], submissions[i]];
    }

    return res.ok({
      voting_opens_at: config.submission_deadline,
      voting_deadline: config.voting_deadline,
      voting_open: isVotingOpen(config),
      submissions
    });
  })
);

export const audienceVote = protect(
  Access.USER,
  handle(async (event) => {
    let data;
    try {
      data = JSON.parse(event.body || "{}");
    } catch {
      return helpers.inputError("Send a JSON object");
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      return helpers.inputError("Send a JSON object");
    helpers.checkPayloadProps(data, {
      team_code: { required: true, type: "string" },
      choice: { required: true, type: "string" }
    });
    if (!/^\d{6}$/.test(data.team_code))
      return helpers.inputError("Send a six-digit team_code");
    if (!["accept", "reject"].includes(data.choice))
      return helpers.inputError("Choice must be accept or reject");
    const event_key = getEventKey();
    const config = await getVotingConfig(event_key);
    if (!isVotingOpen(config))
      return res.send(403, { message: "Voting is closed" });
    const user_id = (event as AuthEvent).auth!.email;
    try {
      await db.updateDBCustom({
        TableName: tableName(),
        Key: { event_key, team_code: data.team_code },
        UpdateExpression: "ADD voter_ids :voters, #counter :one",
        ConditionExpression:
          "attribute_exists(event_key) AND attribute_exists(team_code) AND attribute_exists(submitted_at) AND attribute_exists(video_url) AND video_url <> :empty AND (attribute_not_exists(voter_ids) OR NOT contains(voter_ids, :uid))",
        ExpressionAttributeNames: {
          "#counter": data.choice === "accept" ? "upvotes" : "downvotes"
        },
        ExpressionAttributeValues: {
          ":voters": new Set([user_id]),
          ":uid": user_id,
          ":one": 1,
          ":empty": ""
        }
      });
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        "type" in error &&
        error.type === "ConditionalCheckFailedException"
      )
        return res.send(409, {
          message: "Submission does not exist or you have already voted"
        });
      throw error;
    }
    return res.ok({ has_voted: true });
  })
);

export const saveRubric = protect(
  Access.ADMIN,
  handle(async (event) => {
    const team_code = event.pathParameters?.team_code;
    if (!team_code || !/^\d{6}$/.test(team_code))
      return helpers.inputError("Send a six-digit team_code in the path");
    let data;
    try {
      data = JSON.parse(event.body || "{}");
    } catch {
      return helpers.inputError("Send a JSON object");
    }

    if (
      !data ||
      !Array.isArray(data.scores) ||
      data.scores.length !== PRODUCT_PLUS_RUBRIC_SCORE_COUNT
    )
      return helpers.inputError(
        `Send exactly ${PRODUCT_PLUS_RUBRIC_SCORE_COUNT} scores`
      );

    if (
      !Array.isArray(data.comments) ||
      data.comments.length !== PRODUCT_PLUS_RUBRIC_SCORE_COUNT ||
      !data.comments.every((comment: unknown) => typeof comment === "string")
    )
      return helpers.inputError(
        `Send exactly ${PRODUCT_PLUS_RUBRIC_SCORE_COUNT} comments, one string per score`
      );

    const validScores = data.scores.every(
      (score: unknown) =>
        typeof score === "number" && Number.isFinite(score)
    );
    if (!validScores)
      return helpers.inputError("Scores must be finite numbers");

    const rubric: Rubric = {
      judge_user_id: (event as AuthEvent).auth!.email,
      scores: data.scores,
      comments: data.comments
    };
    const Key = { event_key: getEventKey(), team_code };
    // Compare the prior rubric list, keeping WF2's array shape and submission timestamp untouched.
    for (let attempt = 0; attempt < 5; attempt++) {
      const submission = (await db.getOneCustom({
        TableName: tableName(),
        Key,
        ConsistentRead: true
      })) as { graded_submissions?: Rubric[] } | null;
      if (!submission) return res.notFound("submission", team_code);
      const rubrics = [...(submission.graded_submissions || [])];
      const index = rubrics.findIndex(
        (saved) => saved.judge_user_id === rubric.judge_user_id
      );
      if (index === -1) {
        rubrics.push(rubric);
      } else {
        rubrics[index] = rubric;
      }
      const hasRubrics = submission.graded_submissions !== undefined;
      try {
        await db.updateDBCustom({
          TableName: tableName(),
          Key,
          UpdateExpression: "SET graded_submissions = :rubrics",
          ConditionExpression:
            "attribute_exists(event_key) AND attribute_exists(team_code) AND " +
            (hasRubrics
              ? "graded_submissions = :previous"
              : "attribute_not_exists(graded_submissions)"),
          ExpressionAttributeValues: {
            ":rubrics": rubrics,
            ...(hasRubrics ? { ":previous": submission.graded_submissions } : {})
          }
        });
        return res.ok(rubric);
      } catch (error) {
        if (
          !error ||
          typeof error !== "object" ||
          !("type" in error) ||
          error.type !== "ConditionalCheckFailedException"
        )
          throw error;
      }
    }
    return res.send(409, {
      message: "Submission changed during saving; please retry"
    });
  })
);

export const adminSubmissions = protect(
  Access.ADMIN,
  handle(async () => {
    const event_key = getEventKey();
    const rows = (await querySubmissions(
      event_key,
      "team_code, team_name, graded_submissions, upvotes, downvotes"
    )) as (Pick<Submission, "team_code" | "team_name"> & {
      graded_submissions?: Rubric[];
      upvotes?: number;
      downvotes?: number;
    })[];

    const submissions: RankedSubmission[] = rows.map((row) => {
      const rubrics = row.graded_submissions ?? [];
      const rubric_total = rubrics.reduce(
        (total, rubric) =>
          total + rubric.scores.reduce((sum, score) => sum + score, 0),
        0
      );
      const upvotes = row.upvotes ?? 0;
      const downvotes = row.downvotes ?? 0;
      return {
        team_code: row.team_code,
        team_name: row.team_name,
        rubric_average: rubrics.length ? rubric_total / rubrics.length : null,
        rubric_count: rubrics.length,
        upvotes,
        downvotes,
        audience_score: upvotes - downvotes
      };
    });

    return res.ok(submissions);
  })
);

export const adminSubmission = protect(
  Access.ADMIN,
  handle(async (event) => {
    const team_code = event.pathParameters?.team_code;
    if (!team_code || !/^\d{6}$/.test(team_code))
      return helpers.inputError("Send a six-digit team_code in the path");
    const submission = (await db.getOneCustom({
      TableName: tableName(),
      Key: { event_key: getEventKey(), team_code },
      ConsistentRead: true
    })) as SubmissionRecord | null;
    if (!submission) return res.notFound("submission", team_code);

    const response = await submissionResponse(submission);
    return res.ok({
      ...response,
      graded_submissions: submission.graded_submissions ?? [],
      upvotes: submission.upvotes ?? 0,
      downvotes: submission.downvotes ?? 0
    });
  })
);
