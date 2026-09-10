/**
 * The judging Lambda. Everything about HTTP, auth, validation and errors is generated from
 * the ontology; this file only binds the generated router to our implementation.
 */
import { createHandler } from "@ubc-biztech/sdk/server/judging";
import { JudgingImpl } from "./impl";
import { DynamoStore } from "./store";

const impl = new JudgingImpl(new DynamoStore(process.env.JUDGING_TABLE ?? "biztechJudging"), {
  bootstrapCode: process.env.JUDGING_BOOTSTRAP_CODE || null,
});

export const api = createHandler(impl);
