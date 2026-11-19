// 8-bit up/down counter with enable, synchronous reset and wrap flag (demo design for VCD-Studio)
module counter #(parameter W = 8) (
    input  wire         clk,
    input  wire         rst_n,
    input  wire         en,
    input  wire         up,
    output reg  [W-1:0] q,
    output wire         wrap
);
    assign wrap = en & ((up & (&q)) | (~up & (q == {W{1'b0}})));
    always @(posedge clk) begin
        if (!rst_n)      q <= {W{1'b0}};
        else if (en)     q <= up ? q + 1'b1 : q - 1'b1;
    end
endmodule
