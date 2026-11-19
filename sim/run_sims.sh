#!/bin/bash
# Regenerates demos/*.vcd with iverilog. HOP_DIR = FHSS-Link/rtl/hop_engine (read only; nothing there is modified).
set -e
HOP_DIR="${HOP_DIR:-$HOME/mnt/Github_projects/Projects/FHSS-Link/rtl/hop_engine}"
cd "$(dirname "$0")"; mkdir -p ../demos _b
iverilog -g2005 -o _b/counter counter.v tb_counter.v && (cd ../demos && vvp -n ../sim/_b/counter)
iverilog -g2005 -o _b/fsm fsm.v tb_fsm.v && (cd ../demos && vvp -n ../sim/_b/fsm)
iverilog -g2005 -DVDIR="\"$HOP_DIR/vectors/\"" -o _b/hop "$HOP_DIR/rtl/hop_keyed.v" tb_hop_demo.v && (cd ../demos && vvp -n ../sim/_b/hop)
ls -l ../demos
