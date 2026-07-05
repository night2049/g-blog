import type { GitHubAttachmentResolutionRule } from "../domain/types.ts";

const CANONICAL_USER_ATTACHMENT_PATH =
  /^\/user-attachments\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIVATE_USER_IMAGES_PATH =
  /^\/\d+\/\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export const GITHUB_PRIVATE_ATTACHMENT_VERIFICATION = {
  verificationRepo: "night2049/gblog-private-demo",
  issueNumber: 3,
  capturedAt: "2026-07-05T03:00:00+08:00",
  canonicalUrlShape: "https://github.com/user-attachments/assets/<uuid>",
  signedUrlShape:
    "https://private-user-images.githubusercontent.com/<owner-id>/<asset-id>-<uuid>.<ext>?jwt=<redacted>",
  signedUrlSamples: [
    {
      source: "GitHub REST body_html for sandbox issue #3",
      capturedAt: "2026-07-05T03:00:00+08:00",
      host: "private-user-images.githubusercontent.com",
      path: "/120214987/614857368-<uuid>.png",
      queryParam: "jwt",
      contentTypeHint: "image/png",
    },
    {
      source: "GitHub Web UI open-image copied URL",
      capturedAt: "2026-07-05T03:59:05+08:00",
      host: "private-user-images.githubusercontent.com",
      path: "/69810127/614133415-726e1b6d-46bb-4982-a863-840618e8ed10.jpg",
      queryParam: "jwt",
      contentTypeHint: "image/jpeg",
      jwtIssuer: "github.com",
      jwtAudience: "raw.githubusercontent.com",
      jwtNotBeforeUtc: "2026-07-04T19:59:05.000Z",
      jwtExpiresUtc: "2026-07-04T20:04:05.000Z",
    },
  ],
  markdownApiStatus: 200,
  signedAnonymousStatus: 200,
} as const;

export function createGitHubIssueAttachmentResolutionRules(
  contentRepo: string,
): GitHubAttachmentResolutionRule[] {
  return [
    {
      sourceRepo: contentRepo,
      canonicalHost: "github.com",
      canonicalPathPattern: CANONICAL_USER_ATTACHMENT_PATH,
      signedHost: "private-user-images.githubusercontent.com",
      signedPathPattern: PRIVATE_USER_IMAGES_PATH,
      signedQueryParam: "jwt",
      evidence: GITHUB_PRIVATE_ATTACHMENT_VERIFICATION,
    },
  ];
}
