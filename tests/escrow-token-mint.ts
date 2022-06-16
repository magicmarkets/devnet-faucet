import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { EscrowTokenMint } from "../target/types/escrow_token_mint";
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, MINT_SIZE, createInitializeMintInstruction} from "@solana/spl-token";
import { assert } from "chai";

describe("escrow-token-mint", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  let provider = anchor.getProvider();
  const program = anchor.workspace.EscrowTokenMint as Program<EscrowTokenMint>;

  const initializer = anchor.web3.Keypair.generate()
  let usdcMint = null;

  it("initializes a faucet", async () => {
    const airdropSignature = await provider.connection.requestAirdrop(
      initializer.publicKey,
      2 * LAMPORTS_PER_SOL
    );

    const latest = await provider.connection.getLatestBlockhash();

    await provider.connection.confirmTransaction({
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      signature: airdropSignature,
    });

    usdcMint = await createSplToken(
      provider.connection,
      initializer,
      6,
    );

    const [vault_account_pda, _vault_account_bump] = await PublicKey.findProgramAddress(
      [initializer.publicKey.toBuffer(), Buffer.from("faucet_vault")],
      program.programId
    );

    console.log("initializer:", initializer.publicKey.toBase58())
    console.log("mint:", usdcMint.publicKey.toBase58())
    console.log("pda:", vault_account_pda.toBase58())

    const _tx = await program.rpc.initialize({
      accounts: {
        authority: initializer.publicKey,
        tokenMint: usdcMint.publicKey,
        faucet: vault_account_pda,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [initializer],
    });

    let _vault = await program.account.faucet.fetch(
      vault_account_pda,
    );

    assert.ok(_vault.authority.equals(initializer.publicKey));
    assert.ok(_vault.mint.equals(usdcMint.publicKey));
  });
});


const createSplToken = async (connection: anchor.web3.Connection, wallet: anchor.web3.Keypair, decimals: number): Promise<anchor.web3.Keypair> => {
  const mint = anchor.web3.Keypair.generate();
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);

  const tx = new anchor.web3.Transaction().add(
    anchor.web3.SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: mint.publicKey,
      space: MINT_SIZE,
      lamports: lamports,
      programId: TOKEN_PROGRAM_ID,
    }),

    createInitializeMintInstruction(
      mint.publicKey,
      decimals,
      wallet.publicKey,
      wallet.publicKey
    )
  );

  await anchor.web3.sendAndConfirmTransaction(connection, tx, [wallet, mint]);
  return mint;
};