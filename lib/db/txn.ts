import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { WriteBuilder } from "./build/WriteBuilder.js";
import docClient from "../docClient.js";

export async function txn(...builders: WriteBuilder[]): Promise<TransactWriteCommandOutput> {
  if (builders.length === 0 || builders.length > 100) {
    throw new Error("Transactions require between 1 and 100 writes");
  }

  const items = builders.map(builder => builder.build());
  return docClient.send(new TransactWriteCommand({ TransactItems: items }));
}

/**
 * true when a txn was cancelled only by failed conditions or a concurrent transaction,
 * i.e. the data changed underneath it and a re-read + retry can succeed
 */
export function isConflict(err: unknown): boolean {
  const { name, CancellationReasons } = (err ?? {}) as {
    name?: string;
    CancellationReasons?: { Code?: string }[];
  };

  return name === "TransactionCanceledException" &&
    Array.isArray(CancellationReasons) &&
    CancellationReasons.every(reason =>
      ["None", "ConditionalCheckFailed", "TransactionConflict"].includes(reason.Code ?? ""));
}
