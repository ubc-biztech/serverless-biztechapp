/** Validate URL structure only; this does not check video visibility or duration. */
export function isSupportedYouTubeURL(value: string): boolean {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    return false;
  }

  let videoId: string | null | undefined;

  if (url.hostname === "youtu.be") {
    videoId = /^\/([^/]+)\/?$/.exec(url.pathname)?.[1];
  } else if (
    ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname)
  ) {
    if (url.pathname === "/watch") {
      if (url.searchParams.getAll("v").length !== 1) return false;
      videoId = url.searchParams.get("v");
    } else {
      videoId = /^\/(?:shorts|embed)\/([^/]+)\/?$/.exec(url.pathname)?.[1];
    }
  }

  return typeof videoId === "string" && /^[A-Za-z0-9_-]{11}$/.test(videoId);
}
