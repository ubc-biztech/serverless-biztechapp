import { WriteBuilder } from "./WriteBuilder.js";

/** Check another item in a transaction without modifying it. */
export class ConditionCheckBuilder extends WriteBuilder {
  constructor(table: string, public key: Record<string, unknown>) {
    super(table);
  }

  build() {
    const params = this.buildParams();
    if (!params.ConditionExpression) {
      throw new Error("Condition checks require at least one condition");
    }
    return {
      ConditionCheck: {
        ...params,
        Key: this.key,
        ConditionExpression: params.ConditionExpression,
      },
    };
  }
}
