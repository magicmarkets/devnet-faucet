import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { EscrowTokenMint } from "../target/types/escrow_token_mint";

describe("escrow-token-mint", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  const program = anchor.workspace.EscrowTokenMint as Program<EscrowTokenMint>;

  it("Is initialized!", async () => {
    // Add your test here.
    const tx = await program.rpc.initialize({});
    console.log("Your transaction signature", tx);
  });
});
