# Contributing to VCD-Studio

Thanks for your interest. VCD-Studio is a single-file, offline VCD waveform viewer (`index.html`) built from `src/`.

## Getting started

Open `index.html` in a browser. After editing `src/`, rebuild it:

```
python3 build.py                      # assembles index.html and embeds demos/*.vcd
python3 vcd_stats.py --help           # companion VCD statistics tool
```

`sim/run_sims.sh` regenerates the demo dumps with iverilog; the hop-engine demo needs a checkout of FHSS-Link (`HOP_DIR`).

## Testing

```
python3 tests/test_vcd_stats.py       # stdlib unittest
python3 tests/test_viewer.py          # headless end-to-end; needs Playwright + Chromium (add --big for the large-dump test)
```

## Pull requests

- Open an issue first for larger changes.
- Keep PRs focused and fill in the pull request template.
- Follow `.editorconfig` and match the style of surrounding code.

## Conduct

Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).
