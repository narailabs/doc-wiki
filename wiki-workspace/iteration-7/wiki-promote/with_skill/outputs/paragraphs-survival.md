# Paragraph Survival Analysis

Measures how many of the 5 body paragraphs from the archive survive into the promoted page.

## Method

1. Strip YAML frontmatter from both archive and promoted page
2. Split body on double-newlines, skip headings and empty blocks
3. For each archive paragraph, normalize markdown links (strip `[text](url)` to just `text`)
4. Check whether the first 50 characters of the normalized paragraph appear in the normalized promoted body

## Archive: 5 paragraphs

| # | First 60 chars | In Promoted? |
|---|---------------|-------------|
| P1 | `Authentication in this system is built around JSON Web Token...` | YES |
| P2 | `The session mechanism exists primarily to support revocation...` | YES |
| P3 | `When the access token nears expiry the client exchanges the ...` | YES |
| P4 | `Token delivery follows a split-cookie pattern to mitigate XS...` | YES |
| P5 | `Federated login via OAuth 2.0 / OpenID Connect is supported ...` | YES |

## Link Rewriting Check

Archive used: `[auth concepts](../../wiki/auth.md)`
Promoted uses: `[auth concepts](../auth.md)`

The relative path was corrected from `../../wiki/auth.md` (archive context at `outputs/queries/`) to `../auth.md` (promoted page context at `wiki/auth/`). Both resolve to `wiki/auth.md` from their respective locations.

## Result

Survival rate: **5/5 = 100%**

Threshold: ≥80% required. PASS.
