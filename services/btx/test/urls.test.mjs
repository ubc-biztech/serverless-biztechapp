import assert from "node:assert/strict";
import { test } from "node:test";
import { loadBtx } from "./load-btx.mjs";

const { isSupportedYouTubeURL, isSupportedTwitterURL } = await loadBtx(`
  export { isSupportedYouTubeURL, isSupportedTwitterURL } from "../../lib/urls";
`);
const videoId = "dQw4w9WgXcQ";

test("YouTube validation accepts supported video URL formats", () => {
  for (const url of [
    `https://www.youtube.com/watch?v=${videoId}&t=10`,
    `https://youtu.be/${videoId}/`,
    `https://youtube.com/shorts/${videoId}`,
    `https://youtube.com/embed/${videoId}/`,
  ]) assert.equal(isSupportedYouTubeURL(url), true, url);
});

test("YouTube validation rejects non-video, malformed and unsupported links", () => {
  for (const url of [
    "not a URL", "https://youtube.com/@company",
    "https://youtube.com/watch?v=short",
    `http://youtu.be/${videoId}`, `https://youtube.com.evil.example/watch?v=${videoId}`,
  ]) assert.equal(isSupportedYouTubeURL(url), false, url);
});

test("Twitter/X validation accepts supported HTTPS links and rejects invalid hosts or bare homepages", () => {
  for (const host of ["x.com", "twitter.com"]) {
    assert.equal(isSupportedTwitterURL(`https://${host}/company`), true);
  }
  for (const url of ["not a URL", "https://x.com/", "http://x.com/company",
    "https://x.com.evil.example/company"]) assert.equal(isSupportedTwitterURL(url), false, url);
});
