# boar-bench judge.v2 resume audit

Changed answers can silently retain cached verdicts. This package contains a local CLI reproduction and a proposed repair, tested against commit `b41a25acfabf89f1d015103ca1329554f985a257`.

Read [REPORT.md](REPORT.md) for the finding, scope, source references, and result table.

## Reproduce

Requirements: Node.js with ES modules, Git, and the public upstream source. No npm packages, model login, model API, or credentials are needed.

```sh
git -c core.autocrlf=false clone https://github.com/r4topunk/boar-bench.git
git -C boar-bench -c core.autocrlf=false checkout b41a25acfabf89f1d015103ca1329554f985a257
node verify.mjs ./boar-bench
```

Run from this directory. The script verifies the upstream judge's SHA-256, creates synthetic fixtures under `runs/`, derives `judge-v2.fixed.mjs`, and writes `evidence.json`. It never edits the upstream checkout. A model-call stub throws if invoked; no network request is made by this test.

Expected summary:

```json
{
  "mutations": 8,
  "implementations": 2,
  "unchangedResumesPassed": 16,
  "originalStaleAccepted": 8,
  "fixedStaleRejected": 8,
  "legacyCacheRejected": true,
  "modelCalls": 0,
  "sourceSha256": "9dc669c6ba8d5410c6347ad38b9eb041e6c0f0317dbdd7664ef32602fc692f37"
}
```

`evidence.json` is a saved local result, not a claim about corruption of historical research runs. `proof.png` is a summary figure of that local result.

The upstream MIT notice is preserved in `UPSTREAM-LICENSE.txt`.
