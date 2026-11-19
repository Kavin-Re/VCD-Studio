#!/usr/bin/env python3
"""Writes a synthetic VCD with >1M value changes for performance testing: python3 gen_big_vcd.py out.vcd [cycles]"""
import random, sys
path = sys.argv[1] if len(sys.argv) > 1 else "big.vcd"
cycles = int(sys.argv[2]) if len(sys.argv) > 2 else 330000
random.seed(7)
hdr = """$date synthetic $end
$version gen_big_vcd.py $end
$timescale 1ps $end
$scope module top $end
$var wire 1 ! clk $end
$var reg 16 " cnt [15:0] $end
$var reg 8 # lfsr [7:0] $end
$var reg 1 $ rnd $end
$var reg 64 % wide [63:0] $end
$var reg 12 & sine [11:0] $end
$scope module u $end
$var wire 1 ! clk $end
$var wire 16 " cnt [15:0] $end
$upscope $end
$upscope $end
$enddefinitions $end
"""
import math
lf = 0xA5
w = []
w.append(hdr)
w.append("#0\n$dumpvars\n0!\nb0 \"\nb10100101 #\n0$\nb0 %\nb100000000000 &\n$end\n")
n = 0
rnd = 0
for c in range(1, cycles + 1):
    t = c * 10000
    w.append("#%d\n1!\nb%s \"\n" % (t - 5000, format(c & 0xFFFF, "b")))
    n += 2
    lf = ((lf << 1) | (((lf >> 7) ^ (lf >> 5) ^ (lf >> 4) ^ (lf >> 3)) & 1)) & 0xFF
    w.append("b%s #\n" % format(lf, "b")); n += 1
    if random.random() < 0.5:
        rnd ^= 1; w.append("%d$\n" % rnd); n += 1
    if c % 4 == 0:
        w.append("b%s %%\n" % format(random.getrandbits(64), "b")); n += 1
    s = int(2048 + 2000 * math.sin(c / 500.0))
    w.append("b%s &\n" % format(s, "b")); n += 1
    w.append("#%d\n0!\n" % t); n += 1
sys.stdout.write("")
with open(path, "w") as f:
    f.write("".join(w))
print("wrote %s: about %d value-change records" % (path, n))
