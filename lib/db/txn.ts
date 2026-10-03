import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import type { TransactWriteCommandOutput } from "@aws-sdk/lib-dynamodb";
import type { WriteBuilder } from "./build/WriteBuilder.js";
import docClient from "../docClient.js";

export async function txn(...builders: WriteBuilder[]): Promise<TransactWriteCommandOutput> {
  if (builders.length === 0 || builders.length > 25) {
    throw new Error("Transactions require between 1 and 25 writes");
  }

  const items = builders.map(builder => builder.build());
  return docClient.send(new TransactWriteCommand({ TransactItems: items }));
}
