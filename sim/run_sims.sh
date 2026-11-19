#!/bin/bash
# Regenerates demos/*.vcd with Icarus Verilog (iverilog + vvp).
#
# The third demo dumps the keyed hop engine of the separate FHSS-Link project. HOP_DIR must point at that
# checkout's rtl/hop_engine directory (read only; nothing there is modified). By default a sibling checkout
# next to this repository is used:  <parent>/FHSS-Link/rtl/hop_engine.  Override with:
#     HOP_DIR=/path/to/FHSS-Link/rtl/hop_engine sim/run_sims.sh
# If the directory does not exist the hop demo is skipped and the committed demos/hop_engine.vcd is kept.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
HOP_DIR="${HOP_DIR:-$HERE/../../FHSS-Link/rtl/hop_engine}"
cd "$HERE"; mkdir -p ../demos _b
iverilog -g2005 -o _b/counter counter.v tb_counter.v && (cd ../demos && vvp -n ../sim/_b/counter)
iverilog -g2005 -o _b/fsm fsm.v tb_fsm.v && (cd ../demos && vvp -n ../sim/_b/fsm)
if [ -f "$HOP_DIR/rtl/hop_keyed.v" ]; then
    iverilog -g2005 -DVDIR="\"$HOP_DIR/vectors/\"" -o _b/hop "$HOP_DIR/rtl/hop_keyed.v" tb_hop_demo.v && (cd ../demos && vvp -n ../sim/_b/hop)
else
    echo "note: $HOP_DIR/rtl/hop_keyed.v not found; skipping the hop-engine demo (set HOP_DIR)" >&2
fi
ls -l ../demos
