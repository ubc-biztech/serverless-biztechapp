import { PutBuilder } from "./build/PutBuilder.js";
import { UpdateBuilder } from "./build/UpdateBuilder.js";
import { DeleteBuilder } from "./build/DeleteBuilder.js";

export { field, anyOf, allOf } from "./build/ConditionBuilder.js";

/** exposes chainable builders for transactional writes without immediate execution */
export const build = {
  put(table: string, item: Record<string, unknown>) {
    return new PutBuilder(table, item);
  },
  update(
    table: string,
    key: Record<string, unknown>,
    changes: Record<string, unknown>
  ) {
    return new UpdateBuilder(table, key, changes);
  },
  delete(table: string, key: Record<string, unknown>) {
    return new DeleteBuilder(table, key);
  }
};
