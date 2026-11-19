// Waveform demo for VCD-Studio: drives the existing FHSS-Link keyed hop engine (hop_keyed.v, unmodified)
// with key 0 / start slot 0 from the engine's own vectors and dumps 6 hops. Checks channels against vec_m13.mem.
`timescale 1ns/1ps
module tb_hop_demo;
    reg clk = 0, rst_n = 0;
    reg [127:0] key_in = 0; reg key_we = 0;
    reg [55:0] slot_in = 0; reg slot_we = 0;
    reg req = 0;
    wire busy, valid; wire [3:0] chan;
    hop_keyed #(.M(13), .RW(32), .NCH(2)) dut (.clk(clk), .rst_n(rst_n), .key_in(key_in), .key_we(key_we),
        .slot_in(slot_in), .slot_we(slot_we), .req(req), .busy(busy), .valid(valid), .chan(chan));
    always #5 clk = ~clk;
    reg [15:0]  vec  [0:59999];
    reg [127:0] keys [0:2];
    reg [55:0]  strt [0:2];
    integer i, errs;
    initial begin
        $readmemh({`VDIR, "vec_m13.mem"}, vec);
        $readmemh({`VDIR, "keys_m13.mem"}, keys);
        $readmemh({`VDIR, "starts_m13.mem"}, strt);
        $dumpfile("hop_engine.vcd"); $dumpvars(0, tb_hop_demo);
        errs = 0;
        repeat (3) @(posedge clk); rst_n = 1; repeat (2) @(posedge clk);
        @(negedge clk); key_in = keys[0]; key_we = 1; slot_in = strt[0]; slot_we = 1;
        @(negedge clk); key_we = 0; slot_we = 0;
        for (i = 0; i < 6; i = i + 1) begin
            repeat (i % 3) @(negedge clk);
            req = 1; @(negedge clk); req = 0;
            while (!valid) @(negedge clk);
            if (chan !== vec[i][3:0]) begin errs = errs + 1; $display("MISMATCH hop %0d got %0d exp %0d", i, chan, vec[i][3:0]); end
            else $display("hop %0d -> channel %0d (matches Python vector)", i, chan);
        end
        repeat (3) @(negedge clk);
        $display("tb_hop_demo: %0d mismatches", errs);
        $finish;
    end
endmodule
