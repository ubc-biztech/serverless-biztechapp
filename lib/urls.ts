/** Validate URL structure only; this does not check video visibility or duration. */
export function isSupportedYouTubeURL(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;

    if (url.hostname === "youtu.be") {
      return /^\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname);
    }
    if (!["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)) return false;

    if (url.pathname === "/watch") {
      const ids = url.searchParams.getAll("v");
      return ids.length === 1 && /^[A-Za-z0-9_-]{11}$/.test(ids[0]);
    }
    return /^\/(?:shorts|embed)\/[A-Za-z0-9_-]{11}\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isSupportedTwitterURL(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.port &&
      ["x.com", "www.x.com", "twitter.com", "www.twitter.com", "m.twitter.com"].includes(url.hostname) &&
      url.pathname !== "/";
  } catch {
    return false;
  }
}
