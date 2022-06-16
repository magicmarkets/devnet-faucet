use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, SetAuthority, TokenAccount };
use spl_token::instruction::AuthorityType;
use anchor_lang::solana_program::system_program;

declare_id!("FPsGvf9DktpyhbogiKATThu8TUoGix4mUf35CDL1f92Q");

#[program]
pub mod escrow_token_mint {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        ctx.accounts.faucet.authority = *ctx.accounts.authority.key;
        ctx.accounts.faucet.mint = *ctx.accounts.token_mint.to_account_info().key;
        
        let seeds = b"faucet_authority";
        let (authority, _bump) = Pubkey::find_program_address(&[seeds], ctx.program_id);

        token::set_authority(
            CpiContext::new(ctx.accounts.token_program.clone(), SetAuthority {
                account_or_mint: ctx.accounts.token_mint.to_account_info().clone(),
                current_authority: ctx.accounts.authority.to_account_info(),
            }),
            AuthorityType::MintTokens,
            Some(authority),
        )?;

        Ok(())
    }

    pub fn swap(ctx: Context<Swap>, lamports: u64) -> Result<()> {
        let from = ctx.accounts.depositor.to_account_info();
        let to = ctx.accounts.faucet.to_account_info();

        let amount: u64 = lamports * 100;
        msg!("minting {:?} escrow tokens", amount);
        msg!("from {:?}", from.key.to_bytes());
        msg!("to {:?}", to.key.to_bytes());

        // transfer from depositor to our vault
        let ttx = anchor_lang::solana_program::system_instruction::transfer(
             &from.key,
             &to.key,
             lamports,
        );
    
        anchor_lang::solana_program::program::invoke(
            &ttx,
            &[
                from,
                to,
            ],
        )?;

        // mint 100x lamports to receiver

        let seeds: &[u8] = b"faucet_authority";
        let (_authority, vault_authority_bump) = Pubkey::find_program_address(&[seeds], ctx.program_id);
        let miner_seeds = &[ seeds, &[vault_authority_bump] ];
        let signer_seeds = &[&miner_seeds[..]];

        token::mint_to(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::MintTo {
                    mint: ctx.accounts.token_mint.to_account_info(),
                    to: ctx.accounts.receiver_token_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            ),
            amount as u64).unwrap();
        
        Ok(())
    }

    pub fn sweep_donations(ctx: Context<Sweep>, lamports: u64) -> Result<()> {
        let from = ctx.accounts.vault.to_account_info();
        let to = ctx.accounts.authority.to_account_info();

        let balance = ctx.accounts.vault.to_account_info().lamports();
        msg!("sweeping {:?}/{:?} lamports", lamports, balance);

        **from.try_borrow_mut_lamports()? -= lamports;
        **to.try_borrow_mut_lamports()? += lamports;

        Ok(())
    }
}

#[account]
#[derive(Default)]
pub struct Faucet {
    authority: Pubkey,
    mint: Pubkey,
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(mut)]
    pub token_mint: Account<'info, Mint>, 
    #[account(
        init,
        seeds = [authority.key.as_ref(), b"faucet_vault"],
        bump,
        payer = authority,
        space = 8 + 32 + 32
    )]
    pub faucet: Account<'info, Faucet>,

    /// CHECK:
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
    pub rent: Sysvar<'info, Rent>,
    /// CHECK:
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Swap<'info>{
    #[account(mut)]
    pub depositor: Signer<'info>, 
    /// CHECK:
    #[account(mut)]
    pub receiver_token_account: AccountInfo<'info>, // user escrow token account

    #[account(mut)]
    pub token_mint: Account<'info, Mint>, // outcome tokens
    /// CHECK:
    #[account(mut)]
    pub faucet: Account<'info, Faucet>,
    /// CHECK:
    pub vault_authority: AccountInfo<'info>,

    /// CHECK:
    #[account(address = system_program::ID)]
    pub system_program: AccountInfo<'info>,
    /// CHECK:
    #[account(address = token::ID)]
    pub token_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Sweep<'info> {
    #[account(mut)]
    pub authority: Signer<'info>, 
    #[account(mut)]
    pub vault: Account<'info, Faucet>,
    /// CHECK:
    pub vault_authority: AccountInfo<'info>,
}