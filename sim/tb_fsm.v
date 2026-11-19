`timescale 1ns/1ps
module tb_fsm;
    reg clk = 0, rst_n = 0, din = 0;
    wire detected; wire [2:0] state, next_state;
    seq1011 dut (.clk(clk), .rst_n(rst_n), .din(din), .detected(detected), .state(state), .next_state(next_state));
    always #5 clk = ~clk;
    reg [63:0] stream = 64'hB5D2_6C9B_1B59_D3A7;
    integer i;
    initial begin
        $dumpfile("fsm.vcd"); $dumpvars(0, tb_fsm);
        #27 rst_n = 1;
        for (i = 0; i < 64; i = i + 1) begin
            @(negedge clk); din = stream[i];
        end
        @(negedge clk); rst_n = 0; din = 1;       // reset while input is high
        @(negedge clk); @(negedge clk); rst_n = 1;
        repeat (12) begin @(negedge clk); din = ~din; end
        #20 $finish;
    end
endmodule
