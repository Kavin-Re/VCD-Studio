`timescale 1ns/1ps
module tb_counter;
    reg clk = 0, rst_n = 0, en = 0, up = 1;
    reg [7:0] pat = 8'h00;       // bus driven with 0/1/x/z on purpose (shows x/z highlighting)
    reg       drv = 0;
    wire [7:0] bus = drv ? pat : 8'bz;
    wire [7:0] q; wire wrap;
    counter #(.W(8)) dut (.clk(clk), .rst_n(rst_n), .en(en), .up(up), .q(q), .wrap(wrap));
    always #5 clk = ~clk;                      // 100 MHz
    initial begin
        $dumpfile("counter.vcd"); $dumpvars(0, tb_counter);
        #23 rst_n = 1;                         // q is X until the first clock edge with reset low
        #12 en = 1;
        #330 en = 0;                           // freeze
        #17 en = 1;
        #1  en = 0;                            // 1 ns runt pulse on en (between clock edges, no functional effect)
        #20 en = 1;
        #260 up = 0;                           // count down
        #400 rst_n = 0;  #20 rst_n = 1;        // reset in the middle
        #100 up = 1;
        #600 $finish;
    end
    initial begin                              // tri-state style bus: z, x, then data
        #50  pat = 8'hA5;  drv = 1;
        #40  pat = 8'h5A;
        #40  pat = 8'b1010xx01;
        #40  drv = 0;
        #60  pat = 8'hFF;  drv = 1;
        #30  pat = 8'b0000zzzz;
        #50  pat = 8'h3C;
        #40  drv = 0;
    end
endmodule
