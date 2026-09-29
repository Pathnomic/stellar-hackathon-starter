//! An escrow-style fundraising contract for Soroban.
//!
//! People send money to it while a fundraiser runs. If the goal is reached by
//! the deadline, anyone may call `withdraw`, which pays the contract's whole
//! balance to the beneficiary. If the goal is missed, anyone may call
//! `refund(contributor)`, which pays that contributor's own recorded amount back
//! to them. Money cannot leave any other way: there is no admin transfer, no
//! upgrade entry point, and no function takes a destination address except
//! `refund`, which only ever pays a contributor their own amount.
//!
//! The owner (OpenZeppelin `Ownable`) may pause and unpause new contributions
//! (OpenZeppelin `Pausable`). Pausing never blocks `withdraw` or `refund`.
//!
//! Reviewed, not audited. Built for Stellar's test network only.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, panic_with_error, token,
    Address, Env,
};
use stellar_access::ownable;
use stellar_contract_utils::pausable;
use stellar_macros::only_owner;

#[cfg(test)]
mod test;

/// Stellar closes a ledger about every five seconds. This is the convention
/// OpenZeppelin's own `DAY_IN_LEDGERS = 17280` uses.
const SECONDS_PER_LEDGER: u64 = 5;

/// How long the contract's records stay alive after the deadline, so every
/// supporter has time to take their money back. A record that outlives its TTL
/// is archived, not deleted, and anyone can restore it, so this is about
/// convenience; money is never lost to an expired record.
const REFUND_WINDOW_SECONDS: u64 = 30 * 24 * 60 * 60;

/// Every refusal the contract makes itself. A `pause` or `unpause` the owner
/// did not sign is refused by the host's signature check; pausing twice or
/// unpausing when not paused is refused by OpenZeppelin (`PausableError`
/// 1000-1001).
///
/// Numbered from 100 on purpose: when the token refuses a transfer (for
/// example, a supporter without enough money), its own error (1-14 for a
/// Stellar Asset Contract) comes through this contract unchanged, and it must
/// never read as one of these.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The constructor's goal was zero or negative.
    GoalNotPositive = 100,
    /// The constructor's deadline was not after the current ledger time.
    DeadlineInPast = 101,
    /// A contribution of zero or a negative amount.
    AmountNotPositive = 102,
    /// A contribution at or after the deadline.
    Ended = 103,
    /// `withdraw` or `refund` before the deadline.
    NotEnded = 104,
    /// `withdraw` when the goal was not reached.
    GoalNotReached = 105,
    /// `refund` when the goal was reached.
    GoalReached = 106,
    /// A second `withdraw`.
    AlreadyWithdrawn = 107,
    /// `refund` for someone with nothing recorded (never gave, or already refunded).
    NothingToRefund = 108,
    /// An amount would pass the largest number the contract can hold.
    Overflow = 109,
    /// A contribution while the owner has paused new contributions.
    Paused = 110,
    /// A contribution naming the contract itself as the supporter.
    SelfContribution = 111,
    /// The constructor's beneficiary was the contract itself.
    BeneficiaryIsContract = 112,
}

/// Where the fundraiser stands, derived from the ledger time and the total.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum State {
    /// Before the deadline: contributions are open (unless paused).
    Running,
    /// Deadline passed with the goal reached: `withdraw` pays the beneficiary.
    Succeeded,
    /// Deadline passed with the goal missed: each supporter can be refunded.
    Failed,
}

/// The settings fixed at construction. Never changes afterwards.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub beneficiary: Address,
    pub token: Address,
    pub goal: i128,
    pub deadline: u64,
}

// OpenZeppelin's `Ownable` and `Pausable` keep their own records in this same
// instance storage, under keys named `Owner`, `PendingOwner` and `Paused`. A
// `#[contracttype]` enum key is stored by its variant name, so a `DataKey`
// variant with one of those names would read and overwrite OpenZeppelin's
// record. No variant of `DataKey` may ever use those names.
#[contracttype]
#[derive(Clone)]
enum DataKey {
    /// Instance storage: the `Config`.
    Config,
    /// Instance storage: the amount raised through `contribute`. It never goes
    /// down, so after the deadline the outcome can no longer change.
    Total,
    /// Instance storage: set once `withdraw` has paid the beneficiary.
    Withdrawn,
    /// Persistent storage: one supporter's recorded amount.
    Contribution(Address),
}

/// A supporter's money arrived.
#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Contributed {
    #[topic]
    pub from: Address,
    pub amount: i128,
}

/// The beneficiary was paid.
#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Withdrawn {
    #[topic]
    pub beneficiary: Address,
    pub amount: i128,
}

/// A supporter got their money back.
#[contractevent(data_format = "single-value")]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub contributor: Address,
    pub amount: i128,
}

#[contract]
pub struct Fundraiser;

#[contractimpl]
impl Fundraiser {
    /// Sets the fundraiser up. Refuses a goal that is not positive, a
    /// deadline that is not after the current ledger time, and the contract
    /// itself as the beneficiary.
    pub fn __constructor(
        e: &Env,
        owner: Address,
        beneficiary: Address,
        token: Address,
        goal: i128,
        deadline: u64,
    ) {
        if goal <= 0 {
            panic_with_error!(e, Error::GoalNotPositive);
        }
        if deadline <= e.ledger().timestamp() {
            panic_with_error!(e, Error::DeadlineInPast);
        }
        // Paid to itself, the money could never leave the contract again.
        if beneficiary == e.current_contract_address() {
            panic_with_error!(e, Error::BeneficiaryIsContract);
        }
        ownable::set_owner(e, &owner);
        let config = Config {
            beneficiary,
            token,
            goal,
            deadline,
        };
        e.storage().instance().set(&DataKey::Config, &config);
        keep_instance_alive(e, deadline);
    }

    /// Moves `amount` of the token from `from` to the contract and records it.
    /// Needs `from`'s authorization. Open before the deadline, while not paused.
    /// `from` may not be the contract itself. After the deadline the answer is
    /// `Ended`, paused or not.
    pub fn contribute(e: &Env, from: Address, amount: i128) -> Result<(), Error> {
        // Before any signature check: money the contract already holds must
        // never be recorded as a contribution.
        if from == e.current_contract_address() {
            return Err(Error::SelfContribution);
        }
        from.require_auth();
        let config = read_config(e);
        // The deadline before the pause flag: once the fundraiser has ended,
        // that is the answer, paused or not.
        if e.ledger().timestamp() >= config.deadline {
            return Err(Error::Ended);
        }
        if pausable::paused(e) {
            return Err(Error::Paused);
        }
        if amount <= 0 {
            return Err(Error::AmountNotPositive);
        }
        let key = DataKey::Contribution(from.clone());
        let mine = read_contribution(e, &key)
            .checked_add(amount)
            .ok_or(Error::Overflow)?;
        let total = read_total(e).checked_add(amount).ok_or(Error::Overflow)?;

        // Record first, then move the money. If the transfer fails, the whole
        // call fails and none of these writes happen.
        e.storage().persistent().set(&key, &mine);
        e.storage().instance().set(&DataKey::Total, &total);
        let ledgers = keep_alive_ledgers(e, config.deadline);
        e.storage().persistent().extend_ttl(&key, ledgers, ledgers);
        e.storage().instance().extend_ttl(ledgers, ledgers);

        token::TokenClient::new(e, &config.token).transfer(
            &from,
            e.current_contract_address(),
            &amount,
        );
        Contributed { from, amount }.publish(e);
        Ok(())
    }

    /// Pays the contract's whole balance to the beneficiary, once, after the
    /// deadline, if the goal was reached. Anyone may call it; the money can
    /// only go to the beneficiary.
    pub fn withdraw(e: &Env) -> Result<(), Error> {
        let config = read_config(e);
        if e.ledger().timestamp() < config.deadline {
            return Err(Error::NotEnded);
        }
        if read_total(e) < config.goal {
            return Err(Error::GoalNotReached);
        }
        if read_withdrawn(e) {
            return Err(Error::AlreadyWithdrawn);
        }

        e.storage().instance().set(&DataKey::Withdrawn, &true);
        keep_instance_alive(e, config.deadline);

        let token = token::TokenClient::new(e, &config.token);
        let contract = e.current_contract_address();
        let amount = token.balance(&contract);
        token.transfer(&contract, &config.beneficiary, &amount);
        Withdrawn {
            beneficiary: config.beneficiary,
            amount,
        }
        .publish(e);
        Ok(())
    }

    /// Pays `contributor` their own recorded amount back, after the deadline,
    /// if the goal was missed. Anyone may call it; the money can only go back
    /// to that contributor.
    pub fn refund(e: &Env, contributor: Address) -> Result<(), Error> {
        let config = read_config(e);
        if e.ledger().timestamp() < config.deadline {
            return Err(Error::NotEnded);
        }
        if read_total(e) >= config.goal {
            return Err(Error::GoalReached);
        }
        let key = DataKey::Contribution(contributor.clone());
        let amount = read_contribution(e, &key);
        if amount <= 0 {
            return Err(Error::NothingToRefund);
        }

        e.storage().persistent().remove(&key);
        keep_instance_alive(e, config.deadline);

        token::TokenClient::new(e, &config.token).transfer(
            &e.current_contract_address(),
            &contributor,
            &amount,
        );
        Refunded {
            contributor,
            amount,
        }
        .publish(e);
        Ok(())
    }

    /// Owner only: stops new contributions. `withdraw` and `refund` still work.
    #[only_owner]
    pub fn pause(e: &Env) {
        pausable::pause(e);
        keep_instance_alive(e, read_config(e).deadline);
    }

    /// Owner only: opens contributions again.
    #[only_owner]
    pub fn unpause(e: &Env) {
        pausable::unpause(e);
        keep_instance_alive(e, read_config(e).deadline);
    }

    pub fn goal(e: &Env) -> i128 {
        read_config(e).goal
    }

    pub fn deadline(e: &Env) -> u64 {
        read_config(e).deadline
    }

    /// The amount raised through `contribute`. Refunds and the withdraw do not
    /// lower it.
    pub fn total(e: &Env) -> i128 {
        read_total(e)
    }

    pub fn beneficiary(e: &Env) -> Address {
        read_config(e).beneficiary
    }

    pub fn token(e: &Env) -> Address {
        read_config(e).token
    }

    /// What `of` has contributed and not yet been refunded.
    pub fn contribution(e: &Env, of: Address) -> i128 {
        read_contribution(e, &DataKey::Contribution(of))
    }

    pub fn state(e: &Env) -> State {
        let config = read_config(e);
        if e.ledger().timestamp() < config.deadline {
            State::Running
        } else if read_total(e) >= config.goal {
            State::Succeeded
        } else {
            State::Failed
        }
    }

    pub fn is_paused(e: &Env) -> bool {
        pausable::paused(e)
    }

    /// True once `withdraw` has paid the beneficiary.
    pub fn withdrawn(e: &Env) -> bool {
        read_withdrawn(e)
    }
}

fn read_config(e: &Env) -> Config {
    // Always present: the constructor writes it before the contract exists.
    e.storage().instance().get(&DataKey::Config).unwrap()
}

fn read_total(e: &Env) -> i128 {
    e.storage().instance().get(&DataKey::Total).unwrap_or(0)
}

fn read_withdrawn(e: &Env) -> bool {
    e.storage()
        .instance()
        .get(&DataKey::Withdrawn)
        .unwrap_or(false)
}

fn read_contribution(e: &Env, key: &DataKey) -> i128 {
    e.storage().persistent().get(key).unwrap_or(0)
}

/// How many ledgers to keep a record alive for: through the deadline plus the
/// refund window, and never less than the refund window from now, capped at
/// the network's maximum.
fn keep_alive_ledgers(e: &Env, deadline: u64) -> u32 {
    let now = e.ledger().timestamp();
    let keep_until = deadline.max(now).saturating_add(REFUND_WINDOW_SECONDS);
    let ledgers = keep_until.saturating_sub(now).div_ceil(SECONDS_PER_LEDGER);
    let max = e.storage().max_ttl();
    u32::try_from(ledgers).map_or(max, |ledgers| ledgers.min(max))
}

/// Extends the contract instance (its settings, total and code) on a write.
fn keep_instance_alive(e: &Env, deadline: u64) {
    let ledgers = keep_alive_ledgers(e, deadline);
    e.storage().instance().extend_ttl(ledgers, ledgers);
}
