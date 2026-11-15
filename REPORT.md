# Changed answers silently reuse old judge.v2 verdicts

The public `boar-bench` checklist judge checks prompt/model settings when resuming, but never checks that the answer, question, checklist, conversation history, or refusal policy still matches the cached result. Its stored `answerSha` is not consulted. A changed input exits successfully with zero new work and leaves the old verdict available to `score`.

This is a reproduced benchmark correctness bug, with a tested repair. It does not demonstrate contamination of the published October results.

## Source and mechanism

Repository: [r4topunk/boar-bench](https://github.com/r4topunk/boar-bench), commit `b41a25acfabf89f1d015103ca1329554f985a257`.

Affected file: [`harness/judge-v2.mjs:237–259`](https://github.com/r4topunk/boar-bench/blob/b41a25acfabf89f1d015103ca1329554f985a257/harness/judge-v2.mjs#L237-L259).

1. Lines 237–245 read the current key points, items, and answers.
2. Lines 246–248 reject stale rows only for `promptSha`, `model`, `effort`, `repeat`, or `side` differences.
3. Lines 249–250 treat every remaining cached item ID as done. There is no comparison with the current answer or other input data.
4. Line 255 records `answerSha`, but the resume decision has already happened and never uses it.
5. Lines 258–259 apply the current refusal policy only to uncached items.

Consequently, changing `declined: true` to `false` can retain the old refusal override and its exact-zero score. Likewise, adding `--no-override` to an existing override run does not perform the requested decline-validation judgment: it reports success and skips that item.

The `score` subcommand at lines 285–296 reads judgment rows directly. It neither checks current input content nor warns that an old refusal override is being scored.

## Local reproduction

`verify.mjs` invokes the actual upstream CLI at the pinned commit. It substitutes only the model-call library: any attempted model call throws an error. The upstream scoring, cache handling, and refusal override remain intact. On Windows, a loader converts drive-letter import paths to file URLs; it does not transform source or judge behavior.

For each independent test:

1. Write one item asking for France's capital, one Paris checklist point, and an answer with `declined: true`.
2. Run `judge`. It naturally creates an `ok: true, overridden: true` cache row without a model call.
3. Resume unchanged as a control. It succeeds and preserves the cache bytes.
4. Change exactly one input or option and resume using the same output file.
5. With upstream code, the changed run exits 0, reports `0 to do`, and preserves the original cached row. `score` still emits the original exact-zero refusal result.
6. With the proposed repair, the changed run exits 7 with a stale-input error before a model call. The existing cache stays untouched.

| Changed input or option | Upstream result | Repaired result |
|---|---|---|
| Answer text | Accepts stale cache | Rejects, exit 7 |
| Declined flag | Accepts stale cache | Rejects, exit 7 |
| Question | Accepts stale cache | Rejects, exit 7 |
| Item context | Accepts stale cache | Rejects, exit 7 |
| Key-point checklist | Accepts stale cache | Rejects, exit 7 |
| Conversation history | Accepts stale cache | Rejects, exit 7 |
| `--no-override` | Accepts stale cache | Rejects, exit 7 |
| `--refusal-string` | Accepts stale cache | Rejects, exit 7 |

Results: 8/8 changed cases accepted upstream; 8/8 rejected after repair; 16/16 unchanged-resume controls passed across both implementations. Legacy rows without the new content identity are rejected by the repair. Model calls: zero. Network calls by the reproduction: zero. Full command outcomes are in `evidence.json`.

## Repair

Store a content identity with each row and compare it before building `done`. The supplied repair hashes the current item, key-point row, answer row, `--no-override`, and `--refusal-string`. It preserves the existing prompt/model/effort/repeat/side checks. Missing input identity in legacy rows fails closed; it does not silently relabel historical rows.

The small patch intentionally hashes complete input rows. Metadata-only changes may therefore require a new output file too. A later canonicalization can hash only the fields actually consumed by the prompt and override, provided question, context, checklist order/content, prior turns, answer text, and refusal controls remain covered.

The upstream source is untouched. `verify.mjs` derives a separate repaired copy and checks its behavior against upstream. `resume-input-identity.patch` contains the proposed change.

## Why it matters

Resuming interrupted evaluations is an advertised workflow. Reusing an output path after regenerating answers, revising a checklist, or changing refusal-validation settings silently attaches old verdicts to new inputs. That can invalidate an ablation or validation run without a failed process or an extra judge call. The existing answer hash makes this failure particularly avoidable.

This finding concerns the reusable `judge.v2` instrument, not the headline pairwise U-total. No historical answer/verdict mismatch or change to the published 0/71 result is claimed. It is distinct from claim #9556's v1.1b refusal-rule finding and claim #9575's hidden-thinking timing finding: this reproduction exercises the checklist judge's resume decision before either a new judgment or an override can run.

## Originality check and attribution

The 35 public claims returned for [bounty 1520](https://poidh.xyz/base/bounty/1520) and `docs/ERRATA-BOUNTY-1520.md` were checked on 15 November 2026. None describes this `judge.v2` stale-input resume behavior. This is an independent finding; the existing claim IDs above are comparison references, not its source.

Upstream code is MIT, copyright 2026 r4to, independent researcher. The report and reproduction were prepared with AI assistance and executed locally. See the included upstream MIT notice for reused source context.
