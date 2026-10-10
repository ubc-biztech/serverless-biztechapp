import { WriteBuilder } from "./WriteBuilder.js";

export class UpdateBuilder extends WriteBuilder {
  key: Record<string, unknown>;
  changes: Record<string, unknown>;
  removals: string[] = [];
  setAdditions: [string, Set<unknown>][] = [];
  setDeletions: [string, Set<unknown>][] = [];

  constructor(
    table: string,
    key: Record<string, unknown>,
    changes: Record<string, unknown>
  ) {
    super(table);
    this.key = key;
    this.changes = changes;
  }

  /** REMOVE: drops the attributes from the item */
  remove(...attributes: string[]): this {
    this.removals.push(...attributes);
    return this;
  }

  /** ADD: unions the values into a set attribute, creating it if absent */
  addToSet(attribute: string, values: Iterable<unknown>): this {
    this.setAdditions.push([attribute, new Set(values)]);
    return this;
  }

  /** DELETE: subtracts the values from a set attribute */
  removeFromSet(attribute: string, values: Iterable<unknown>): this {
    this.setDeletions.push([attribute, new Set(values)]);
    return this;
  }

  build() {
    const params = this.buildParams();
    const names: Record<string, string> = { ...params.ExpressionAttributeNames };
    const values: Record<string, unknown> = { ...params.ExpressionAttributeValues };
    let nameIndex = 0;
    let valueIndex = 0;

    const name = (attribute: string): string => {
      if (attribute.length === 0) {
        throw new Error("Update attributes must not be empty");
      }
      if (Object.prototype.hasOwnProperty.call(this.key, attribute)) {
        throw new Error(`Cannot update key attribute: ${attribute}`);
      }

      const alias = `#u${nameIndex++}`;
      names[alias] = attribute;
      return alias;
    };

    const value = (attribute: string, raw: unknown): string => {
      if (raw === undefined) {
        throw new Error(`Update values must not be undefined: ${attribute}`);
      }
      if (raw instanceof Set && raw.size === 0) {
        throw new Error(`Set operations require at least one value: ${attribute}`);
      }

      const placeholder = `:u${valueIndex++}`;
      values[placeholder] = raw;
      return placeholder;
    };

    const clauses: [string, string[]][] = [
      ["SET", Object.entries(this.changes).map(([attribute, raw]) => `${name(attribute)} = ${value(attribute, raw)}`)],
      ["REMOVE", this.removals.map(attribute => name(attribute))],
      ["ADD", this.setAdditions.map(([attribute, raw]) => `${name(attribute)} ${value(attribute, raw)}`)],
      ["DELETE", this.setDeletions.map(([attribute, raw]) => `${name(attribute)} ${value(attribute, raw)}`)]
    ];

    const updateExpression = clauses
      .filter(([, parts]) => parts.length > 0)
      .map(([action, parts]) => `${action} ${parts.join(", ")}`)
      .join(" ");

    if (updateExpression.length === 0) {
      throw new Error("Updates require at least one changed attribute");
    }

    return {
      Update: {
        ...params,
        Key: this.key,
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: names,
        // a REMOVE-only update with value-free conditions has no values, and Dynamo rejects an empty map
        ...(Object.keys(values).length > 0 && { ExpressionAttributeValues: values })
      }
    };
  }
}
