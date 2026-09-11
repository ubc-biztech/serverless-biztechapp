import db from "../../lib/db.js";
import { JUDGING_EVENTS_TABLE } from "./constants";

/** A row in biztechJudging. `id` is the event key, `sk` the record key within the event. */
export type Item = { id: string; sk: string; [k: string]: unknown };

/**
 * The four operations impl.ts needs, so it can be tested against MemoryStore without AWS.
 * DynamoStore is a thin pass-through to lib/db, like every other service.
 */
export interface Store {
  get(id: string, sk: string): Promise<Item | null>;
  put(item: Item, createNew: boolean): Promise<void>;
  delete(id: string, sk: string): Promise<void>;
  /** Every row in the event whose sk starts with `skPrefix`. */
  list(id: string, skPrefix: string): Promise<Item[]>;
}

export class DynamoStore implements Store {
  async get(id: string, sk: string) {
    return (await db.getOne(id, JUDGING_EVENTS_TABLE, { sk })) as Item | null;
  }
  async put(item: Item, createNew: boolean) {
    await db.put(item, JUDGING_EVENTS_TABLE, createNew);
  }
  async delete(id: string, sk: string) {
    await db.deleteOne(id, JUDGING_EVENTS_TABLE, { sk });
  }
  async list(id: string, skPrefix: string) {
    return (await db.query(JUDGING_EVENTS_TABLE, null, {
      expression: "#id = :id AND begins_with(#sk, :p)",
      expressionValues: { ":id": id, ":p": skPrefix },
      expressionNames: { "#id": "id", "#sk": "sk" }
    })) as Item[];
  }
}

export class MemoryStore implements Store {
  readonly items = new Map<string, Item>();
  private k(id: string, sk: string) {
    return `${id} ${sk}`;
  }
  async get(id: string, sk: string) {
    return structuredClone(this.items.get(this.k(id, sk)) ?? null);
  }
  async put(item: Item, createNew: boolean) {
    const exists = this.items.has(this.k(item.id, item.sk));
    if (createNew && exists) throw new Error("ConditionalCheckFailedException: item exists");
    if (!createNew && !exists) throw new Error("ConditionalCheckFailedException: item missing");
    this.items.set(this.k(item.id, item.sk), structuredClone(item));
  }
  async delete(id: string, sk: string) {
    this.items.delete(this.k(id, sk));
  }
  async list(id: string, skPrefix: string) {
    return [...this.items.values()].filter((i) => i.id === id && i.sk.startsWith(skPrefix)).map((i) => structuredClone(i));
  }
}
