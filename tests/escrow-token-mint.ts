import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { EscrowTokenMint } from "../target/types/escrow_token_mint";
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, MINT_SIZE, createInitializeMintInstruction, createAccount } from "@solana/spl-token";
import { assert } from "chai";

describe("escrow-token-mint", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.Provider.env());

  let provider = anchor.getProvider();
  const program = anchor.workspace.EscrowTokenMint as Program<EscrowTokenMint>;

  const initializer = anchor.web3.Keypair.generate()
  const depositor = anchor.web3.Keypair.generate()
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
      [usdcMint.publicKey.toBuffer(), Buffer.from("faucet_vault")],
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

    let vault = await program.account.faucet.fetch(
      vault_account_pda,
    );

    assert.ok(vault.authority.equals(initializer.publicKey));
    assert.ok(vault.mint.equals(usdcMint.publicKey));
  });

  it("swaps SOL for 100x tokens", async () => {
    const airdropSignature = await provider.connection.requestAirdrop(
      depositor.publicKey,
      2 * LAMPORTS_PER_SOL
    );

    const latest = await provider.connection.getLatestBlockhash();

    await provider.connection.confirmTransaction({
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
      signature: airdropSignature,
    });

    let tokenAccount = await createAccount(provider.connection, depositor, usdcMint.publicKey, depositor.publicKey);

    const [vault_account_pda, _vault_account_bump] = await PublicKey.findProgramAddress(
      [usdcMint.publicKey.toBuffer(), Buffer.from("faucet_vault")],
      program.programId
    );

    const [authority, _vault_authority_bump] = await PublicKey.findProgramAddress(
      [Buffer.from("faucet_authority")],
      program.programId
    );

    console.log("depositor:", depositor.publicKey.toBase58())

    const amount = new anchor.BN(1.02 * LAMPORTS_PER_SOL);
    const _tx = await program.rpc.swap(amount, {
      accounts: {
        depositor: depositor.publicKey,
        receiverTokenAccount: tokenAccount,
        tokenMint: usdcMint.publicKey,
        faucet: vault_account_pda, // populated by prev test
        vaultAuthority: authority,
        systemProgram: anchor.web3.SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      },
      signers: [depositor],
    });

    let tokenBalance = await provider.connection.getTokenAccountBalance(tokenAccount);
    assert.ok(tokenBalance.value.uiAmount > 0);
    assert.ok(tokenBalance.value.uiAmount == 102);

    let balance = await provider.connection.getBalance(depositor.publicKey);
    assert.ok(balance < 1 * LAMPORTS_PER_SOL);
  });

  it("allows the initializer to sweep funds", async () => {
    const [vault_account_pda, _vault_account_bump] = await PublicKey.findProgramAddress(
      [usdcMint.publicKey.toBuffer(), Buffer.from("faucet_vault")],
      program.programId
    );


    let balance0 = await provider.connection.getBalance(initializer.publicKey);

    const amount = new anchor.BN(1.01 * LAMPORTS_PER_SOL);
    const _tx = await program.rpc.sweep(amount, {
      accounts: {
        authority: initializer.publicKey,
        faucet: vault_account_pda, // populated by prev test
      },
      signers: [initializer],
    });

    let balance1 = await provider.connection.getBalance(initializer.publicKey);
    assert.ok(balance0 < balance1);
  });


  it("rejects to sweep funds not by authority", async () => {
    const [vault_account_pda, _vault_account_bump] = await PublicKey.findProgramAddress(
      [usdcMint.publicKey.toBuffer(), Buffer.from("faucet_vault")],
      program.programId
    );

    const amount = new anchor.BN(0.01 * LAMPORTS_PER_SOL);
    try {
      const _tx = await program.rpc.sweep(amount, {
        accounts: {
          authority: depositor.publicKey,
          faucet: vault_account_pda, // populated by prev test
        },
        signers: [depositor],
      });
      assert.ok(false);
    } catch(e) {
      const errMsg = "wrong authority";
      assert.equal(e.toString(), errMsg);
    }
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