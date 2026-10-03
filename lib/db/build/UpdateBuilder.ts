import { WriteBuilder } from "./WriteBuilder.js";

export class UpdateBuilder extends WriteBuilder {
  key: Record<string, unknown>;
  changes: Record<string, unknown>;

  constructor(
    table: string,
    key: Record<string, unknown>,
    changes: Record<string, unknown>
  ) {
    super(table);
    this.key = key;
    this.changes = changes;
  }

  build() {
    const entries = Object.entries(this.changes);
    if (entries.length === 0) {
      throw new Error("Updates require at least one changed attribute");
    }

    const params = this.buildParams();
    const names: Record<string, string> = { ...params.ExpressionAttributeNames };
    const values: Record<string, unknown> = { ...params.ExpressionAttributeValues };
    const assignments = entries.map(([attribute, value], index) => {
      if (attribute.length === 0) {
        throw new Error("Update attributes must not be empty");
      }
      if (Object.prototype.hasOwnProperty.call(this.key, attribute)) {
        throw new Error(`Cannot update key attribute: ${attribute}`);
      }
      if (value === undefined) {
        throw new Error(`Update values must not be undefined: ${attribute}`);
      }

      const name = `#u${index}`;
      const placeholder = `:u${index}`;
      names[name] = attribute;
      values[placeholder] = value;
      return `${name} = ${placeholder}`;
    });

    return {
      Update: {
        ...params,
        Key: this.key,
        UpdateExpression: `SET ${assignments.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values
      }
    };
  }
}
