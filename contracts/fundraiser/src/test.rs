//! Tests t01-t10 are the ten rows of the spec's Tests section, in order.
//! t11-t13 prove the spec's other rules: one event per withdraw and refund, a
//! failed transfer leaves no state, and every write keeps records alive.
//! t14-t19 prove the follow-ups of the 2026-09-28 independent review: the
//! `withdrawn` view, the two refusals of the contract's own address, the
//! deadline answered before the pause flag, and a refused payout or refund
//! that changes nothing and can be retried.
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::EnvTestConfig,
    testutils::{
        storage::{Instance as _, Persistent as _},
        Address as _, Events as _, IssuerFlags, Ledger as _, MockAuth, MockAuthInvoke,
        StellarAssetIssuer,
    },
    token::{StellarAssetClient, TokenClient},
    vec, xdr, Env, IntoVal, InvokeError, Symbol, Val,
};

/// A test environment that does not write snapshot files into the crate.
fn new_env() -> Env {
    Env::new_with_config(EnvTestConfig {
        capture_snapshot_at_drop: false,
    })
}

/// A ledger time in 2026, so "now" is realistic.
const START: u64 = 1_790_000_000;
const DAY: u64 = 24 * 60 * 60;
/// One whole unit of a 7-decimal token (one XLM is 10,000,000 stroops).
const UNIT: i128 = 10_000_000;
const GOAL: i128 = 1_000 * UNIT;
const DEADLINE: u64 = START + 30 * DAY;

/// One fundraiser on a registered Stellar Asset Contract, with every
/// authorization mocked unless a test says otherwise.
struct Fixture {
    env: Env,
    owner: Address,
    beneficiary: Address,
    token: TokenClient<'static>,
    minter: StellarAssetClient<'static>,
    issuer: StellarAssetIssuer,
    fundraiser: FundraiserClient<'static>,
}

impl Fixture {
    fn new() -> Self {
        Self::with_deadline(DEADLINE)
    }

    fn with_deadline(deadline: u64) -> Self {
        let env = new_env();
        env.ledger().set_timestamp(START);
        env.mock_all_auths();
        let owner = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
        let token = TokenClient::new(&env, &sac.address());
        let minter = StellarAssetClient::new(&env, &sac.address());
        let id = env.register(
            Fundraiser,
            FundraiserArgs::__constructor(&owner, &beneficiary, &sac.address(), &GOAL, &deadline),
        );
        let fundraiser = FundraiserClient::new(&env, &id);
        Fixture {
            env,
            owner,
            beneficiary,
            token,
            minter,
            issuer: sac.issuer(),
            fundraiser,
        }
    }

    /// A new supporter holding `balance` of the token.
    fn supporter(&self, balance: i128) -> Address {
        let who = Address::generate(&self.env);
        self.minter.mint(&who, &balance);
        who
    }

    fn pass_deadline(&self) {
        self.env.ledger().set_timestamp(DEADLINE);
    }

    /// Makes the token refuse to credit `who`, as a stand-in for an account
    /// that cannot receive yet (on Testnet: a payout under 1 XLM to an account
    /// that does not exist). The token's refusal is its error 11.
    fn cannot_receive(&self, who: &Address) {
        self.issuer.set_flag(IssuerFlags::RevocableFlag);
        self.minter.set_authorized(who, &false);
    }

    /// Lets `who` receive again, as if someone had funded that account.
    fn can_receive(&self, who: &Address) {
        self.minter.set_authorized(who, &true);
    }

    /// The events this fundraiser (not the token) emitted in the last call.
    fn own_events(&self) -> soroban_sdk::testutils::ContractEvents {
        self.env
            .events()
            .all()
            .filter_by_contract(&self.fundraiser.address)
    }

    /// One event in the shape the contract publishes: topics `[name, address]`,
    /// data the amount.
    fn event(
        &self,
        name: &str,
        who: &Address,
        amount: i128,
    ) -> (Address, soroban_sdk::Vec<Val>, Val) {
        (
            self.fundraiser.address.clone(),
            vec![
                &self.env,
                Symbol::new(&self.env, name).into_val(&self.env),
                who.into_val(&self.env),
            ],
            amount.into_val(&self.env),
        )
    }
}

/// True when the host, not the contract's own logic, refused a call that
/// returns nothing: a missing or wrong signature.
fn refused_by_host(
    result: Result<
        Result<(), soroban_sdk::ConversionError>,
        Result<soroban_sdk::Error, InvokeError>,
    >,
) -> bool {
    matches!(result, Err(Ok(error)) if !error.is_type(xdr::ScErrorType::Contract))
}

/// Registers a fundraiser with these settings and returns the message the
/// constructor refused with. Panics if the constructor accepts them.
fn constructor_refusal(goal: i128, deadline: u64) -> std::string::String {
    let env = new_env();
    env.ledger().set_timestamp(START);
    let owner = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(&env));
    let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register(
            Fundraiser,
            FundraiserArgs::__constructor(&owner, &beneficiary, &sac.address(), &goal, &deadline),
        )
    }));
    panic_message(outcome.expect_err("the constructor accepted settings it must refuse"))
}

/// The text a caught panic carried, or an empty string.
fn panic_message(payload: std::boxed::Box<dyn std::any::Any + Send>) -> std::string::String {
    if let Some(message) = payload.downcast_ref::<std::string::String>() {
        message.clone()
    } else if let Some(message) = payload.downcast_ref::<&str>() {
        std::string::String::from(*message)
    } else {
        std::string::String::new()
    }
}

#[test]
fn t01_constructor_refuses_bad_goal_and_deadline() {
    let goal_not_positive = "Error(Contract, #100)";
    let deadline_in_past = "Error(Contract, #101)";
    for goal in [0, -1, i128::MIN] {
        let message = constructor_refusal(goal, DEADLINE);
        assert!(
            message.contains(goal_not_positive),
            "goal {goal}: {message}"
        );
    }
    for deadline in [START, START - 1, 0] {
        let message = constructor_refusal(GOAL, deadline);
        assert!(
            message.contains(deadline_in_past),
            "deadline {deadline}: {message}"
        );
    }

    // Control: the smallest valid settings are accepted and stored.
    let f = Fixture::with_deadline(START + 1);
    assert_eq!(f.fundraiser.deadline(), START + 1);
    assert_eq!(f.fundraiser.goal(), GOAL);
    assert_eq!(f.fundraiser.state(), State::Running);
}

#[test]
fn t02_goal_reached_withdraw_pays_the_beneficiary_the_full_balance() {
    let f = Fixture::new();
    assert_eq!(f.fundraiser.beneficiary(), f.beneficiary);
    assert_eq!(f.fundraiser.token(), f.token.address);
    assert_eq!(f.fundraiser.goal(), GOAL);
    assert_eq!(f.fundraiser.deadline(), DEADLINE);

    let alice = f.supporter(700 * UNIT);
    let bob = f.supporter(500 * UNIT);
    f.fundraiser.contribute(&alice, &(600 * UNIT));
    f.fundraiser.contribute(&bob, &(500 * UNIT));
    assert_eq!(f.fundraiser.total(), 1_100 * UNIT);
    assert_eq!(f.fundraiser.contribution(&alice), 600 * UNIT);
    assert_eq!(f.fundraiser.contribution(&bob), 500 * UNIT);
    // The goal is reached, but it is still running until the deadline.
    assert_eq!(f.fundraiser.state(), State::Running);

    // Money sent straight to the contract, not through contribute, is part of
    // the balance the beneficiary receives.
    let stray = f.supporter(5);
    f.token.transfer(&stray, &f.fundraiser.address, &5);

    f.pass_deadline();
    assert_eq!(f.fundraiser.state(), State::Succeeded);
    // Anyone may trigger it: no signature of any kind is needed.
    f.fundraiser.mock_auths(&[]).withdraw();

    assert_eq!(f.token.balance(&f.beneficiary), 1_100 * UNIT + 5);
    assert_eq!(f.token.balance(&f.fundraiser.address), 0);
    assert_eq!(f.fundraiser.state(), State::Succeeded);
    assert_eq!(f.fundraiser.total(), 1_100 * UNIT);
}

#[test]
fn t03_withdraw_refuses_before_the_deadline_and_a_second_time() {
    let f = Fixture::new();
    let alice = f.supporter(GOAL);
    f.fundraiser.contribute(&alice, &GOAL);

    assert_eq!(f.fundraiser.try_withdraw(), Err(Ok(Error::NotEnded)));
    f.env.ledger().set_timestamp(DEADLINE - 1);
    assert_eq!(f.fundraiser.try_withdraw(), Err(Ok(Error::NotEnded)));
    assert_eq!(f.token.balance(&f.beneficiary), 0);

    f.pass_deadline();
    f.fundraiser.withdraw();
    assert_eq!(f.token.balance(&f.beneficiary), GOAL);

    assert_eq!(
        f.fundraiser.try_withdraw(),
        Err(Ok(Error::AlreadyWithdrawn))
    );
    assert_eq!(f.token.balance(&f.beneficiary), GOAL);
}

#[test]
fn t04_goal_missed_each_supporter_gets_exactly_their_money_back() {
    let f = Fixture::new();
    let alice = f.supporter(300 * UNIT);
    let bob = f.supporter(200 * UNIT);
    f.fundraiser.contribute(&alice, &(120 * UNIT));
    f.fundraiser.contribute(&bob, &(200 * UNIT));
    f.fundraiser.contribute(&alice, &(30 * UNIT));
    assert_eq!(f.fundraiser.contribution(&alice), 150 * UNIT);
    assert_eq!(f.fundraiser.total(), 350 * UNIT);

    f.pass_deadline();
    assert_eq!(f.fundraiser.state(), State::Failed);
    assert_eq!(f.fundraiser.try_withdraw(), Err(Ok(Error::GoalNotReached)));

    // Anyone may trigger a refund (no signature at all); it pays only that
    // supporter, exactly their amount.
    f.fundraiser.mock_auths(&[]).refund(&alice);
    assert_eq!(f.token.balance(&alice), 300 * UNIT);
    assert_eq!(f.token.balance(&bob), 0);
    assert_eq!(f.fundraiser.contribution(&alice), 0);
    assert_eq!(
        f.fundraiser.try_refund(&alice),
        Err(Ok(Error::NothingToRefund))
    );
    assert_eq!(f.token.balance(&alice), 300 * UNIT);

    f.fundraiser.mock_auths(&[]).refund(&bob);
    assert_eq!(f.token.balance(&bob), 200 * UNIT);
    assert_eq!(
        f.fundraiser.try_refund(&bob),
        Err(Ok(Error::NothingToRefund))
    );

    let never_gave = Address::generate(&f.env);
    assert_eq!(
        f.fundraiser.try_refund(&never_gave),
        Err(Ok(Error::NothingToRefund))
    );

    assert_eq!(f.token.balance(&f.fundraiser.address), 0);
    assert_eq!(f.fundraiser.state(), State::Failed);
    assert_eq!(f.fundraiser.try_withdraw(), Err(Ok(Error::GoalNotReached)));
}

#[test]
fn t05_refund_refuses_when_the_goal_is_reached_or_before_the_deadline() {
    let f = Fixture::new();
    let alice = f.supporter(GOAL);
    f.fundraiser.contribute(&alice, &GOAL);
    assert_eq!(f.fundraiser.try_refund(&alice), Err(Ok(Error::NotEnded)));
    f.pass_deadline();
    assert_eq!(f.fundraiser.try_refund(&alice), Err(Ok(Error::GoalReached)));
    assert_eq!(f.token.balance(&alice), 0);

    let g = Fixture::new();
    let bob = g.supporter(UNIT);
    g.fundraiser.contribute(&bob, &UNIT);
    assert_eq!(g.fundraiser.try_refund(&bob), Err(Ok(Error::NotEnded)));
    g.env.ledger().set_timestamp(DEADLINE - 1);
    assert_eq!(g.fundraiser.try_refund(&bob), Err(Ok(Error::NotEnded)));
    assert_eq!(g.token.balance(&bob), 0);
    assert_eq!(g.fundraiser.contribution(&bob), UNIT);
}

#[test]
fn t06_contribute_refuses_after_the_deadline_and_amounts_that_are_not_positive() {
    let f = Fixture::new();
    let alice = f.supporter(100);
    for amount in [0, -1, i128::MIN] {
        assert_eq!(
            f.fundraiser.try_contribute(&alice, &amount),
            Err(Ok(Error::AmountNotPositive)),
            "amount {amount}"
        );
    }

    // One second before the deadline it is still open.
    f.env.ledger().set_timestamp(DEADLINE - 1);
    f.fundraiser.contribute(&alice, &40);

    f.pass_deadline();
    assert_eq!(
        f.fundraiser.try_contribute(&alice, &10),
        Err(Ok(Error::Ended))
    );
    f.env.ledger().set_timestamp(DEADLINE + DAY);
    assert_eq!(
        f.fundraiser.try_contribute(&alice, &10),
        Err(Ok(Error::Ended))
    );

    assert_eq!(f.fundraiser.total(), 40);
    assert_eq!(f.token.balance(&alice), 60);
}

#[test]
fn t07_contribute_needs_the_contributors_own_authorization() {
    let f = Fixture::new();
    let alice = f.supporter(100);
    let mallory = Address::generate(&f.env);

    let transfer = [MockAuthInvoke {
        contract: &f.token.address,
        fn_name: "transfer",
        args: (&alice, &f.fundraiser.address, 100_i128).into_val(&f.env),
        sub_invokes: &[],
    }];
    let contribute = MockAuthInvoke {
        contract: &f.fundraiser.address,
        fn_name: "contribute",
        args: (&alice, 100_i128).into_val(&f.env),
        sub_invokes: &transfer,
    };

    // Signed by the wrong account: refused, and nothing moved or was recorded.
    let wrong_signer = [MockAuth {
        address: &mallory,
        invoke: &contribute,
    }];
    assert_eq!(
        f.fundraiser
            .mock_auths(&wrong_signer)
            .try_contribute(&alice, &100),
        Err(Err(InvokeError::Abort))
    );
    // Signed by nobody: refused the same way.
    assert_eq!(
        f.fundraiser.mock_auths(&[]).try_contribute(&alice, &100),
        Err(Err(InvokeError::Abort))
    );
    // Signed by the contributor for the token transfer alone: refused too.
    // The contributor must authorize `contribute` itself, not just the
    // movement of money inside it.
    let transfer_only = [MockAuth {
        address: &alice,
        invoke: &transfer[0],
    }];
    assert_eq!(
        f.fundraiser
            .mock_auths(&transfer_only)
            .try_contribute(&alice, &100),
        Err(Err(InvokeError::Abort))
    );
    assert_eq!(f.fundraiser.total(), 0);
    assert_eq!(f.fundraiser.contribution(&alice), 0);
    assert_eq!(f.token.balance(&alice), 100);

    // Control: the same call signed by the contributor goes through.
    let right_signer = [MockAuth {
        address: &alice,
        invoke: &contribute,
    }];
    f.fundraiser
        .mock_auths(&right_signer)
        .contribute(&alice, &100);
    assert_eq!(f.fundraiser.total(), 100);
    assert_eq!(f.token.balance(&alice), 0);
}

#[test]
fn t08_pause_blocks_only_contributions_and_only_the_owner_can_pause() {
    let f = Fixture::new();
    let alice = f.supporter(GOAL);
    f.fundraiser.contribute(&alice, &GOAL);

    let pause = MockAuthInvoke {
        contract: &f.fundraiser.address,
        fn_name: "pause",
        args: ().into_val(&f.env),
        sub_invokes: &[],
    };
    let unpause = MockAuthInvoke {
        contract: &f.fundraiser.address,
        fn_name: "unpause",
        args: ().into_val(&f.env),
        sub_invokes: &[],
    };

    // A non-owner cannot pause.
    let stranger = Address::generate(&f.env);
    let by_stranger = [MockAuth {
        address: &stranger,
        invoke: &pause,
    }];
    assert!(refused_by_host(
        f.fundraiser.mock_auths(&by_stranger).try_pause()
    ));
    assert!(!f.fundraiser.is_paused());

    // The owner can.
    let by_owner = [MockAuth {
        address: &f.owner,
        invoke: &pause,
    }];
    f.fundraiser.mock_auths(&by_owner).pause();
    assert!(f.fundraiser.is_paused());

    // A non-owner cannot unpause either.
    let unpause_by_stranger = [MockAuth {
        address: &stranger,
        invoke: &unpause,
    }];
    assert!(refused_by_host(
        f.fundraiser.mock_auths(&unpause_by_stranger).try_unpause()
    ));
    assert!(f.fundraiser.is_paused());

    // Paused: contribute refuses and nothing is recorded or moved.
    let bob = f.supporter(UNIT);
    assert_eq!(
        f.fundraiser.try_contribute(&bob, &UNIT),
        Err(Ok(Error::Paused))
    );
    assert_eq!(f.fundraiser.total(), GOAL);
    assert_eq!(f.token.balance(&bob), UNIT);

    // Still paused after the deadline: withdraw works.
    f.pass_deadline();
    f.fundraiser.withdraw();
    assert_eq!(f.token.balance(&f.beneficiary), GOAL);
    assert!(f.fundraiser.is_paused());

    // A missed goal, paused: refund works.
    let g = Fixture::new();
    let carol = g.supporter(UNIT);
    g.fundraiser.contribute(&carol, &UNIT);
    g.fundraiser.pause();
    g.pass_deadline();
    g.fundraiser.refund(&carol);
    assert_eq!(g.token.balance(&carol), UNIT);
    assert!(g.fundraiser.is_paused());

    // The owner's unpause opens contributions again.
    let h = Fixture::new();
    h.fundraiser.pause();
    let dave = h.supporter(UNIT);
    assert_eq!(
        h.fundraiser.try_contribute(&dave, &UNIT),
        Err(Ok(Error::Paused))
    );
    let unpause_by_owner = [MockAuth {
        address: &h.owner,
        invoke: &MockAuthInvoke {
            contract: &h.fundraiser.address,
            fn_name: "unpause",
            args: ().into_val(&h.env),
            sub_invokes: &[],
        },
    }];
    h.fundraiser.mock_auths(&unpause_by_owner).unpause();
    assert!(!h.fundraiser.is_paused());
    h.fundraiser.contribute(&dave, &UNIT);
    assert_eq!(h.fundraiser.total(), UNIT);
}

#[test]
fn t09_contributions_near_i128_max_refuse_with_overflow() {
    let f = Fixture::new();
    let whale = f.supporter(i128::MAX - 10);
    f.fundraiser.contribute(&whale, &(i128::MAX - 10));
    assert_eq!(f.fundraiser.total(), i128::MAX - 10);

    // Another supporter's 11 would carry the total past i128::MAX.
    let minnow = f.supporter(11);
    assert_eq!(
        f.fundraiser.try_contribute(&minnow, &11),
        Err(Ok(Error::Overflow))
    );
    // The same supporter's 11 more would carry their own amount past it too.
    f.minter.mint(&whale, &11);
    assert_eq!(
        f.fundraiser.try_contribute(&whale, &11),
        Err(Ok(Error::Overflow))
    );

    // Nothing wrapped, nothing was recorded, nothing moved.
    assert_eq!(f.fundraiser.total(), i128::MAX - 10);
    assert_eq!(f.fundraiser.contribution(&whale), i128::MAX - 10);
    assert_eq!(f.fundraiser.contribution(&minnow), 0);
    assert_eq!(f.token.balance(&minnow), 11);
    assert_eq!(f.token.balance(&whale), 11);

    // Control: landing exactly on i128::MAX is allowed.
    let exact = f.supporter(10);
    f.fundraiser.contribute(&exact, &10);
    assert_eq!(f.fundraiser.total(), i128::MAX);
}

#[test]
fn t10_contribute_emits_exactly_one_event_with_the_address_and_amount() {
    let f = Fixture::new();
    let alice = f.supporter(250);
    f.fundraiser.contribute(&alice, &250);
    assert_eq!(
        f.own_events(),
        vec![&f.env, f.event("contributed", &alice, 250)]
    );
}

#[test]
fn t11_withdraw_and_refund_each_emit_exactly_one_event() {
    let f = Fixture::new();
    let alice = f.supporter(GOAL);
    f.fundraiser.contribute(&alice, &GOAL);
    f.pass_deadline();
    f.fundraiser.withdraw();
    assert_eq!(
        f.own_events(),
        vec![&f.env, f.event("withdrawn", &f.beneficiary, GOAL)]
    );

    let g = Fixture::new();
    let bob = g.supporter(UNIT);
    g.fundraiser.contribute(&bob, &UNIT);
    g.pass_deadline();
    g.fundraiser.refund(&bob);
    assert_eq!(
        g.own_events(),
        vec![&g.env, g.event("refunded", &bob, UNIT)]
    );
}

#[test]
fn t12_a_failed_transfer_leaves_no_state() {
    let f = Fixture::new();
    let alice = f.supporter(100);

    // Alice offers more than she holds: the token refuses the transfer, so the
    // whole call fails, including the writes made before the transfer. The
    // token's own refusal (code 10, not enough balance) comes through as it
    // is, and never reads as one of this contract's errors.
    assert_eq!(
        f.fundraiser.try_contribute(&alice, &101),
        Err(Err(InvokeError::Contract(10)))
    );
    assert_eq!(f.fundraiser.total(), 0);
    assert_eq!(f.fundraiser.contribution(&alice), 0);
    assert_eq!(f.token.balance(&alice), 100);
    assert_eq!(f.token.balance(&f.fundraiser.address), 0);
    assert_eq!(f.own_events(), vec![&f.env]);

    // Control: within her balance it goes through.
    f.fundraiser.contribute(&alice, &100);
    assert_eq!(f.fundraiser.total(), 100);
}

#[test]
fn t13_every_write_keeps_records_alive_past_the_refund_window() {
    const LEDGERS_PER_DAY: u32 = 17_280;
    let window = 30 * LEDGERS_PER_DAY;
    let instance_ttl = |f: &Fixture| {
        f.env.as_contract(&f.fundraiser.address, || {
            f.env.storage().instance().get_ttl()
        })
    };
    let entry_ttl = |f: &Fixture, who: &Address| {
        f.env.as_contract(&f.fundraiser.address, || {
            f.env
                .storage()
                .persistent()
                .get_ttl(&DataKey::Contribution(who.clone()))
        })
    };
    // Moves the clock to `days` after START, with the ledger sequence in step
    // at one ledger every five seconds.
    let go_to_day = |f: &Fixture, days: u32| {
        f.env.ledger().set_timestamp(START + u64::from(days) * DAY);
        f.env.ledger().set_sequence_number(days * LEDGERS_PER_DAY);
    };

    // A 30-day fundraiser: the constructor and a contribution keep the
    // instance and the supporter's record for 30 + 30 days.
    let f = Fixture::new();
    assert!(instance_ttl(&f) >= 60 * LEDGERS_PER_DAY, "constructor");
    let alice = f.supporter(UNIT);
    f.fundraiser.contribute(&alice, &UNIT);
    assert!(
        instance_ttl(&f) >= 60 * LEDGERS_PER_DAY,
        "contribute: instance"
    );
    assert!(
        entry_ttl(&f, &alice) >= 60 * LEDGERS_PER_DAY,
        "contribute: entry"
    );

    // A one-day fundraiser, three days on: without a write, less than the
    // refund window is left; a refund tops it back up to the full window.
    let short = Fixture::with_deadline(START + DAY);
    let bob = short.supporter(UNIT);
    short.fundraiser.contribute(&bob, &UNIT);
    assert!(
        instance_ttl(&short) >= 31 * LEDGERS_PER_DAY,
        "short: contribute"
    );
    short.env.ledger().set_timestamp(START + 3 * DAY);
    short.env.ledger().set_sequence_number(3 * LEDGERS_PER_DAY);
    assert!(instance_ttl(&short) < window, "short: before the refund");
    short.fundraiser.refund(&bob);
    assert!(instance_ttl(&short) >= window, "short: refund");

    // The same for a withdraw: a one-day fundraiser that reached its goal,
    // three days on.
    let paid = Fixture::with_deadline(START + DAY);
    let carol = paid.supporter(GOAL);
    paid.fundraiser.contribute(&carol, &GOAL);
    go_to_day(&paid, 3);
    assert!(instance_ttl(&paid) < window, "paid: before the withdraw");
    paid.fundraiser.withdraw();
    assert!(instance_ttl(&paid) >= window, "paid: withdraw");

    // And for pause and unpause, each on its own: three days on the owner
    // pauses, three days later the owner unpauses.
    let owned = Fixture::with_deadline(START + DAY);
    go_to_day(&owned, 3);
    assert!(instance_ttl(&owned) < window, "owned: before the pause");
    owned.fundraiser.pause();
    assert!(instance_ttl(&owned) >= window, "owned: pause");
    go_to_day(&owned, 6);
    assert!(instance_ttl(&owned) < window, "owned: before the unpause");
    owned.fundraiser.unpause();
    assert!(instance_ttl(&owned) >= window, "owned: unpause");

    // A far deadline is capped at the network maximum instead of failing. A
    // day on, a day of the instance's lifetime is gone; a contribution tops
    // it back up to the cap.
    let far = Fixture::with_deadline(START + 20 * 365 * DAY);
    let max = far
        .env
        .as_contract(&far.fundraiser.address, || far.env.storage().max_ttl());
    assert_eq!(instance_ttl(&far), max, "far: constructor");
    go_to_day(&far, 1);
    assert_eq!(
        instance_ttl(&far),
        max - LEDGERS_PER_DAY,
        "far: before the contribution"
    );
    let bob = far.supporter(UNIT);
    far.fundraiser.contribute(&bob, &UNIT);
    assert_eq!(instance_ttl(&far), max, "far: contribute: instance");
    assert_eq!(entry_ttl(&far, &bob), max, "far: contribute: entry");
}

#[test]
fn t14_withdrawn_shows_whether_the_beneficiary_was_paid() {
    let f = Fixture::new();
    assert!(!f.fundraiser.withdrawn());
    let alice = f.supporter(GOAL);
    f.fundraiser.contribute(&alice, &GOAL);
    f.pass_deadline();
    assert_eq!(f.fundraiser.state(), State::Succeeded);
    assert!(!f.fundraiser.withdrawn());
    f.fundraiser.withdraw();
    assert!(f.fundraiser.withdrawn());

    // A missed goal is never marked, refunds or not.
    let g = Fixture::new();
    let bob = g.supporter(UNIT);
    g.fundraiser.contribute(&bob, &UNIT);
    g.pass_deadline();
    g.fundraiser.refund(&bob);
    assert!(!g.fundraiser.withdrawn());
}

#[test]
fn t15_the_contract_cannot_contribute_as_itself() {
    let f = Fixture::new();
    // Money sent straight to the contract is the contract's own balance.
    let stray = f.supporter(GOAL);
    f.token.transfer(&stray, &f.fundraiser.address, &GOAL);
    let itself = f.fundraiser.address.clone();

    // Refused even in the test mode that grants every signature, the
    // contract's own included, so that money can never be recorded as a
    // contribution and count towards the goal.
    assert_eq!(
        f.fundraiser.try_contribute(&itself, &GOAL),
        Err(Ok(Error::SelfContribution))
    );
    // With no signature at all the answer is the same: the check comes before
    // any signature check.
    assert_eq!(
        f.fundraiser.mock_auths(&[]).try_contribute(&itself, &GOAL),
        Err(Ok(Error::SelfContribution))
    );
    assert_eq!(f.fundraiser.total(), 0);
    assert_eq!(f.fundraiser.contribution(&itself), 0);
    assert_eq!(f.token.balance(&itself), GOAL);
    assert_eq!(f.own_events(), vec![&f.env]);

    // Control: a supporter's own contribution still goes through.
    let alice = f.supporter(UNIT);
    f.fundraiser.contribute(&alice, &UNIT);
    assert_eq!(f.fundraiser.total(), UNIT);
}

/// Registers a fundraiser at the address `id`, paying `beneficiary`, and
/// returns the constructor's refusal, or `None` if it accepted.
fn refusal_at(env: &Env, id: &Address, beneficiary: &Address) -> Option<std::string::String> {
    let owner = Address::generate(env);
    let sac = env.register_stellar_asset_contract_v2(Address::generate(env));
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        env.register_at(
            id,
            Fundraiser,
            FundraiserArgs::__constructor(&owner, beneficiary, &sac.address(), &GOAL, &DEADLINE),
        )
    }))
    .err()
    .map(panic_message)
}

#[test]
fn t16_the_beneficiary_cannot_be_the_contract_itself() {
    // The contract's address is known before it exists; naming it as the
    // beneficiary is refused.
    let env = new_env();
    env.ledger().set_timestamp(START);
    let id = Address::generate(&env);
    let message = refusal_at(&env, &id, &id).expect("the contract was its own beneficiary");
    assert!(message.contains("Error(Contract, #112)"), "{message}");

    // Control: the same address with someone else as the beneficiary.
    let env = new_env();
    env.ledger().set_timestamp(START);
    let id = Address::generate(&env);
    let beneficiary = Address::generate(&env);
    assert_eq!(refusal_at(&env, &id, &beneficiary), None);
    assert_eq!(FundraiserClient::new(&env, &id).beneficiary(), beneficiary);
}

#[test]
fn t17_after_the_deadline_contribute_answers_ended_even_while_paused() {
    // Paused before the deadline: `Paused` until the deadline, `Ended` after.
    let f = Fixture::new();
    let alice = f.supporter(UNIT);
    f.fundraiser.pause();
    assert_eq!(
        f.fundraiser.try_contribute(&alice, &UNIT),
        Err(Ok(Error::Paused))
    );
    f.pass_deadline();
    assert!(f.fundraiser.is_paused());
    assert_eq!(
        f.fundraiser.try_contribute(&alice, &UNIT),
        Err(Ok(Error::Ended))
    );

    // Paused after the deadline: `Ended` too.
    let g = Fixture::new();
    let bob = g.supporter(UNIT);
    g.pass_deadline();
    g.fundraiser.pause();
    assert!(g.fundraiser.is_paused());
    assert_eq!(
        g.fundraiser.try_contribute(&bob, &UNIT),
        Err(Ok(Error::Ended))
    );

    assert_eq!(f.fundraiser.total(), 0);
    assert_eq!(g.fundraiser.total(), 0);
    assert_eq!(f.token.balance(&alice), UNIT);
    assert_eq!(g.token.balance(&bob), UNIT);
}

#[test]
fn t18_a_refused_payout_changes_nothing_and_can_be_retried() {
    let f = Fixture::new();
    let alice = f.supporter(GOAL);
    f.fundraiser.contribute(&alice, &GOAL);
    f.pass_deadline();
    f.cannot_receive(&f.beneficiary);

    // The token refuses to pay the beneficiary, so the whole withdraw fails,
    // including the withdrawn mark written before the transfer.
    let refused = Err(Err(InvokeError::Contract(11)));
    assert_eq!(f.fundraiser.try_withdraw(), refused);
    assert!(!f.fundraiser.withdrawn());
    assert_eq!(f.own_events(), vec![&f.env]);
    // A retry fails the same way, not with `AlreadyWithdrawn`.
    assert_eq!(f.fundraiser.try_withdraw(), refused);
    assert!(!f.fundraiser.withdrawn());
    assert_eq!(f.token.balance(&f.fundraiser.address), GOAL);
    assert_eq!(f.token.balance(&f.beneficiary), 0);

    // Once the beneficiary can receive, a retry pays in full.
    f.can_receive(&f.beneficiary);
    f.fundraiser.withdraw();
    assert!(f.fundraiser.withdrawn());
    assert_eq!(f.token.balance(&f.beneficiary), GOAL);
    assert_eq!(f.token.balance(&f.fundraiser.address), 0);
}

#[test]
fn t19_a_refused_refund_changes_nothing_and_can_be_retried() {
    let f = Fixture::new();
    let alice = f.supporter(UNIT);
    f.fundraiser.contribute(&alice, &UNIT);
    f.pass_deadline();
    f.cannot_receive(&alice);

    // The token refuses to pay Alice back, so the whole refund fails,
    // including the removal of her record written before the transfer.
    let refused = Err(Err(InvokeError::Contract(11)));
    assert_eq!(f.fundraiser.try_refund(&alice), refused);
    assert_eq!(f.fundraiser.contribution(&alice), UNIT);
    assert_eq!(f.own_events(), vec![&f.env]);
    // A retry fails the same way, not with `NothingToRefund`.
    assert_eq!(f.fundraiser.try_refund(&alice), refused);
    assert_eq!(f.fundraiser.contribution(&alice), UNIT);
    assert_eq!(f.token.balance(&f.fundraiser.address), UNIT);
    assert_eq!(f.token.balance(&alice), 0);

    // Once Alice can receive, a retry pays her in full, once.
    f.can_receive(&alice);
    f.fundraiser.refund(&alice);
    assert_eq!(f.token.balance(&alice), UNIT);
    assert_eq!(f.fundraiser.contribution(&alice), 0);
    assert_eq!(f.token.balance(&f.fundraiser.address), 0);
    assert_eq!(
        f.fundraiser.try_refund(&alice),
        Err(Ok(Error::NothingToRefund))
    );
}
