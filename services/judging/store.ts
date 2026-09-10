/**
 * Storage for the judging service: one DynamoDB table, one partition per event.
 *
 *   pk = EVENT#<eventID>#<year>
 *   sk = SETTINGS | RUBRIC | TEAM#<id> | JUDGE#<id> | REVIEW#<id> | LINK#<id> | CODE#<code>
 *
 * `Store` is deliberately a four-method key-value interface so the implementation can be
 * tested against `MemoryStore` without AWS. Nothing in impl.ts knows it is DynamoDB.
 */
import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import docClient from "../../lib/docClient";

export type Item = { pk: string; sk: string; [k: string]: unknown };

export interface Store {
  get(pk: string, sk: string): Promise<Item | null>;
  put(item: Item): Promise<void>;
  delete(pk: string, sk: string): Promise<void>;
  /** Every item in the partition whose sk starts with `skPrefix`. */
  list(pk: string, skPrefix: string): Promise<Item[]>;
}

export class DynamoStore implements Store {
  constructor(private readonly table: string) {}
  async get(pk: string, sk: string) {
    const r = await docClient.send(new GetCommand({ TableName: this.table, Key: { pk, sk } }));
    return (r.Item as Item | undefined) ?? null;
  }
  async put(item: Item) {
    await docClient.send(new PutCommand({ TableName: this.table, Item: item }));
  }
  async delete(pk: string, sk: string) {
    await docClient.send(new DeleteCommand({ TableName: this.table, Key: { pk, sk } }));
  }
  async list(pk: string, skPrefix: string) {
    const out: Item[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const r = await docClient.send(
        new QueryCommand({
          TableName: this.table,
          KeyConditionExpression: "pk = :pk AND begins_with(sk, :p)",
          ExpressionAttributeValues: { ":pk": pk, ":p": skPrefix },
          ExclusiveStartKey,
        }),
      );
      out.push(...((r.Items as Item[] | undefined) ?? []));
      ExclusiveStartKey = r.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (ExclusiveStartKey);
    return out;
  }
}

export class MemoryStore implements Store {
  readonly items = new Map<string, Item>();
  private k(pk: string, sk: string) {
    return `${pk} ${sk}`;
  }
  async get(pk: string, sk: string) {
    return structuredClone(this.items.get(this.k(pk, sk)) ?? null);
  }
  async put(item: Item) {
    this.items.set(this.k(item.pk, item.sk), structuredClone(item));
  }
  async delete(pk: string, sk: string) {
    this.items.delete(this.k(pk, sk));
  }
  async list(pk: string, skPrefix: string) {
    return [...this.items.values()].filter((i) => i.pk === pk && i.sk.startsWith(skPrefix)).map((i) => structuredClone(i));
  }
}
