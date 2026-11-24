# Detection benchmark baseline

Synthetic seeded corpus (seed 20261124, 760 samples). All values are random, none are real identifiers.
Command: `node eval/bench/run.mjs --seed 20261124 --per 40`

**Overall:** precision 99.7% · recall 88.4% · F1 93.7% · character leakage 9.0% · p50 0.008 ms · p99 0.081 ms

| Subset | Size | Result |
|---|---|---|
| A contextual | 280 spans | recall 100.0%, char leakage 0.0% |
| B unlabelled | 280 spans | recall 85.7%, char leakage 9.6% |
| C structured | 160 spans | recall 100.0%, char leakage 0.0% |
| D negatives | 120 samples | false-positive rate 0.0% |
| E OCR-garbled | 80 spans | recall 33.8%, char leakage 66.3% |

Matching rule: a prediction counts when its category equals the gold category and it covers at least half of the gold span.
Not measured here: OCR accuracy, real-page DOM text, end-to-end latency (these need a real browser).
