// Small in-memory interpreter for the DynamoDB expression subset used by these
// tests. It applies supplied conditions/updates, rather than assuming handler
// behavior. Unsupported syntax fails loudly; real DynamoDB integration is separate.
export function matches(row, expression, names = {}, values = {}) {
  if (!expression) return true;
  const tokens = expression.match(
    /attribute_not_exists|attribute_exists|contains|AND|OR|NOT|<>|=|[#:a-zA-Z_][\w:]*|[(),]/g
  );
  let index = 0;
  const take = (expected) => {
    const token = tokens[index++];
    if (expected && token !== expected)
      throw new Error(`Expected ${expected}, got ${token}`);
    return token;
  };
  const resolve = (token) =>
    token.startsWith(":") ? values[token] : row?.[names[token] || token];
  function atom() {
    if (tokens[index] === "NOT") {
      take();
      return !atom();
    }
    if (tokens[index] === "(") {
      take();
      const result = or();
      take(")");
      return result;
    }
    const token = take();
    if (
      ["attribute_exists", "attribute_not_exists", "contains"].includes(token)
    ) {
      take("(");
      const value = resolve(take());
      if (token === "contains") {
        take(",");
        const member = resolve(take());
        take(")");
        return value instanceof Set
          ? value.has(member)
          : Array.isArray(value) || typeof value === "string"
            ? value.includes(member)
            : false;
      }
      take(")");
      return token === "attribute_exists"
        ? value !== undefined
        : value === undefined;
    }
    const left = resolve(token);
    const operator = take();
    const right = resolve(take());
    if (operator === "=") return left === right;
    if (operator === "<>") return left !== right;
    throw new Error(`Unsupported comparison ${operator}`);
  }
  function and() {
    let result = atom();
    while (tokens[index] === "AND") {
      take();
      const next = atom();
      result = result && next;
    }
    return result;
  }
  function or() {
    let result = and();
    while (tokens[index] === "OR") {
      take();
      const next = and();
      result = result || next;
    }
    return result;
  }
  const result = or();
  if (index !== tokens.length) throw new Error("Unsupported condition syntax");
  return result;
}

export function update(row, params) {
  const names = params.ExpressionAttributeNames || {};
  const values = params.ExpressionAttributeValues || {};
  if (!matches(row, params.ConditionExpression, names, values))
    throw { type: "ConditionalCheckFailedException" };
  const next = structuredClone(row || params.Key);
  const sections = [
    ...params.UpdateExpression.matchAll(
      /\b(SET|ADD|REMOVE|DELETE)\b([^]*?)(?=\b(?:SET|ADD|REMOVE|DELETE)\b|$)/g
    )
  ];
  if (!sections.length) throw new Error("Unsupported update syntax");
  for (const [, action, text] of sections) {
    for (const entry of text.trim().split(/\s*,\s*/)) {
      const parts = entry.trim().split(/\s*=\s*|\s+/);
      const field = names[parts[0]] || parts[0];
      const value = values[parts[1]];
      if (action === "SET") next[field] = structuredClone(value);
      else if (action === "ADD") {
        next[field] =
          value instanceof Set
            ? new Set([...(next[field] || []), ...value])
            : (next[field] || 0) + value;
      } else if (action === "REMOVE") delete next[field];
      else throw new Error(`Unsupported update action ${action}`);
    }
  }
  return next;
}

export function scan(rows, params) {
  return rows
    .filter((row) =>
      matches(
        row,
        params.FilterExpression,
        params.ExpressionAttributeNames,
        params.ExpressionAttributeValues
      )
    )
    .map((row) => {
      if (!params.ProjectionExpression) return structuredClone(row);
      return Object.fromEntries(
        params.ProjectionExpression.split(",")
          .map((name) => {
            const field =
              params.ExpressionAttributeNames?.[name.trim()] || name.trim();
            return [field, row[field]];
          })
          .filter(([, value]) => value !== undefined)
      );
    });
}
