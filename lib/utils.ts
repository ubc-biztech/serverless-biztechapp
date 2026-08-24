export type Comparer = (a: any, b: any) => number;

// Alphabetical comparer, a -z
// BUG (pre-existing, preserved): the no-`property` branch reads `a.toLowerCase`
// without calling it, so it compares function references rather than strings and
// always returns 0. Callers that omit `property` get an unsorted result.
export const alphabeticalComparer =(property?: string): Comparer => (a: any, b: any): number => {
  let top, bot;
  if(property) {
    top = a[property] ? a[property].toLowerCase() : "";
    bot = b[property] ? b[property].toLowerCase() : "";
  }
  else {
    top = a ? a.toLowerCase : "";
    bot = b ? b.toLowerCase : "";
  }
  return top !== bot ? (top > bot ? 1 : -1) : 0;
};

// Date comparer, putting the most 'recent' at the start
export const dateComparer = (property?: string): Comparer => (a: any, b: any): number => {
  let top: any, bot: any;
  if(property) {
    top = a[property] ? new Date(a[property]) : 0;
    bot = b[property] ? new Date(b[property]) : 0;
  }
  else {
    top = a ? new Date(a) : 0;
    bot = b ? new Date(b) : 0;
  }
  return bot - top;
};

export const isEmpty = (obj: any): boolean => {
  if (obj === null  || obj === undefined) return true;
  if (Array.isArray(obj) || typeof obj === "string") return obj.length === 0;
  return Object.keys(obj).length === 0;
};

// Checks if an email is valid
export const isValidEmail = (email: unknown): boolean => {
  const re = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
  return re.test(String(email).toLowerCase());
};
