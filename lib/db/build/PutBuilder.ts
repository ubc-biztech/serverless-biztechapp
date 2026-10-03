import { WriteBuilder } from "./WriteBuilder.js";

export class PutBuilder extends WriteBuilder {
  item: Record<string, unknown>;

  constructor(table: string, item: Record<string, unknown>) {
    super(table);
    this.item = item;
  }

  build() {
    return {
      Put: {
        ...this.buildParams(),
        Item: this.item
      }
    };
  }
}
