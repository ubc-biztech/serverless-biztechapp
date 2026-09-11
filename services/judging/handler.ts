import { createHandler } from "@ubc-biztech/sdk/server/judging";
import { JudgingImpl } from "./impl";
import { DynamoStore } from "./store";

/**
 * Routing, auth, validation and error mapping are generated from the ontology in
 * ubc-biztech/sdk; this service supplies the business logic (impl.ts) and storage (store.ts).
 * One function serves every route under /judging.
 */
export const api = createHandler(
  new JudgingImpl(new DynamoStore(), { bootstrapCode: process.env.JUDGING_BOOTSTRAP_CODE || null })
);
