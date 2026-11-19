// Overlapping "1011" sequence detector, Moore machine (demo design for VCD-Studio)
module seq1011 (
    input  wire clk,
    input  wire rst_n,
    input  wire din,
    output wire detected,
    output reg  [2:0] state,
    output reg  [2:0] next_state
);
    localparam [2:0] IDLE = 3'd0, S1 = 3'd1, S10 = 3'd2, S101 = 3'd3, DET = 3'd4;
    assign detected = (state == DET);
    always @(*) begin
        case (state)
            IDLE:    next_state = din ? S1   : IDLE;
            S1:      next_state = din ? S1   : S10;
            S10:     next_state = din ? S101 : IDLE;
            S101:    next_state = din ? DET  : S10;
            DET:     next_state = din ? S1   : S10;
            default: next_state = IDLE;
        endcase
    end
    always @(posedge clk) begin
        if (!rst_n) state <= IDLE;
        else        state <= next_state;
    end
endmodule
