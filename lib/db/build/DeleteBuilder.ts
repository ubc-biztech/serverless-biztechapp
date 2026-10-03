import { WriteBuilder } from "./WriteBuilder.js";

export class DeleteBuilder extends WriteBuilder {
  key: Record<string, unknown>;

  constructor(table: string, key: Record<string, unknown>) {
    super(table);
    this.key = key;
  }

  build() {
    return {
      Delete: {
        ...this.buildParams(),
        Key: this.key
      }
    };
  }
}
