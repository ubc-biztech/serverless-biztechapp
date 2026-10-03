/**
 * base builder for writes to a Dynamo table with chainable conditions
 *
 * usage:
 * import db, { field } from "../../db.js";
 *
 * db.build.put(TABLE, item)
 *   .if("eventID;year").equals("blueprint;2027")
 *   .anyOf(
 *     field("status").equals("active"),
 *     field("status").notExists()
 *   )
 */

import { ConditionBuilder, anyOf, allOf } from "./ConditionBuilder.js";
import type { Condition } from "./ConditionBuilder.js";
import type { TransactWriteCommandInput } from "@aws-sdk/lib-dynamodb";

export type TransactionWrite = NonNullable<TransactWriteCommandInput["TransactItems"]>[number];

type WriteParams = Pick<
  NonNullable<TransactionWrite["Put"]>,
  "TableName" | "ConditionExpression" | "ExpressionAttributeNames" | "ExpressionAttributeValues"
>;

export abstract class WriteBuilder {
  table: string;
  conditions: Condition[] = [];

  constructor(table: string) {
    this.table = table;
  }

  abstract build(): TransactionWrite;

  if(field: string): ConditionBuilder<this> {
    return new ConditionBuilder(field, condition => {
      this.conditions.push(condition);
      return this;
    });
  }

  anyOf(...conditions: Condition[]): this {
    this.conditions.push(anyOf(...conditions));
    return this;
  }

  allOf(...conditions: Condition[]): this {
    this.conditions.push(allOf(...conditions));
    return this;
  }

  protected buildParams(): WriteParams {
    const params: WriteParams = {
      TableName: this.table + (process.env.ENVIRONMENT || "")
    };

    if (this.conditions.length === 0) return params;

    const names: Record<string, string> = {};
    const values: Record<string, unknown> = {};
    let nameIndex = 0;
    let valueIndex = 0;

    const compile = (condition: Condition): string => {
      if ("conditions" in condition) {
        if (condition.conditions.length === 0) {
          throw new Error("Condition groups must contain at least one condition");
        }

        const operator = condition.type === "and" ? " AND " : " OR ";
        return `(${condition.conditions.map(compile).join(operator)})`;
      }

      if (condition.attribute.length === 0) {
        throw new Error("Condition attributes must not be empty");
      }

      const name = `#c${nameIndex++}`;
      names[name] = condition.attribute;

      switch (condition.type) {
      case "exists":
        return `attribute_exists(${name})`;
      case "notExists":
        return `attribute_not_exists(${name})`;
      case "equals": {
        if (condition.value === undefined) {
          throw new Error("Equality conditions must not use undefined");
        }

        const value = `:c${valueIndex++}`;
        values[value] = condition.value;
        return `${name} = ${value}`;
      }
      }
    };

    params.ConditionExpression = this.conditions.map(compile).join(" AND ");
    params.ExpressionAttributeNames = names;

    if (Object.keys(values).length > 0) {
      params.ExpressionAttributeValues = values;
    }

    return params;
  }
}
