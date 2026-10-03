/**
 * builder for conditional writes to a Dynamo table
 *
 * usage: db.build.put(...).if("eventID;year").equals("blueprint;2027")
 * standalone: field("status").equals("active")
 */

export type Condition =
  | { type: "exists" | "notExists"; attribute: string }
  | { type: "equals" | "notEquals" | "contains" | "hasSize"; attribute: string; value: unknown }
  | { type: "and" | "or"; conditions: Condition[] };

export class ConditionBuilder<T> {
  field: string;
  private accept: (condition: Condition) => T;

  constructor(field: string, accept: (condition: Condition) => T) {
    this.field = field;
    this.accept = accept;
  }

  exists(): T {
    return this.accept({
      type: "exists",
      attribute: this.field,
    });
  }

  notExists(): T {
    return this.accept({
      type: "notExists",
      attribute: this.field,
    });
  }

  equals(value: unknown): T {
    return this.accept({
      type: "equals",
      attribute: this.field,
      value,
    });
  }

  notEquals(value: unknown): T {
    return this.accept({
      type: "notEquals",
      attribute: this.field,
      value,
    });
  }

  contains(value: unknown): T {
    return this.accept({
      type: "contains",
      attribute: this.field,
      value,
    });
  }

  hasSize(size: number): T {
    return this.accept({
      type: "hasSize",
      attribute: this.field,
      value: size,
    });
  }
}

export function field(attribute: string): ConditionBuilder<Condition> {
  return new ConditionBuilder(attribute, condition => condition);
}

export function anyOf(...conditions: Condition[]): Condition {
  return group("or", conditions);
}

export function allOf(...conditions: Condition[]): Condition {
  return group("and", conditions);
}

function group(type: "and" | "or", conditions: Condition[]): Condition {
  if (conditions.length === 0) {
    throw new Error("Condition groups must contain at least one condition");
  }

  return {
    type,
    conditions
  };
}
