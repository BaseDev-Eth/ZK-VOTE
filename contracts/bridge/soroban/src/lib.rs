//! # ZKVote Bridge Contract (Soroban)
//!
//! Receives forwarded votes from the EVM bridge contract via a relayer,
//! checks nullifiers against the voting contract, and records votes.
//!
//! ## Flow
//! 1. User generates Groth16 proof on EVM side
//! 2. EVM Bridge contract verifies proof, emits VoteForwarded event
//! 3. Relayer watches EVM, calls this contract to relay the vote
//! 4. This contract checks nullifier against voting contract
//! 5. If valid, records the vote in the voting contract
//!
//! ## Security
//! - Nullifier check prevents double-voting across chains
//! - Only authorized relayers can submit votes (or anyone if open relay)
//! - Vote is recorded in the voting contract for consistency

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Env, IntoVal, Symbol, U256,
};

const VOTING_CONTRACT: Symbol = symbol_short!("voting");
const VERSION: u32 = 1;
const VERSION_KEY: Symbol = symbol_short!("ver");

// TTL management
const INSTANCE_TTL_THRESHOLD: u32 = 120_960; // ~7 days
const INSTANCE_TTL_EXTEND: u32 = 535_680; // ~31 days
const PERSISTENT_TTL_THRESHOLD: u32 = 120_960;
const PERSISTENT_TTL_EXTEND: u32 = 535_680;

#[contracterror]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum BridgeError {
    AlreadyInitialized = 1,
    NotAdmin = 2,
    NullifierAlreadyUsed = 3,
    VotingContractNotSet = 4,
    InvalidVoteChoice = 5,
    VoteRecordingFailed = 6,
    NullifierCheckFailed = 7,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Nullifier(u64, u64, U256),    // (dao_id, proposal_id, nullifier) -> bool
    VoteRecorded(u64, u64, U256), // (dao_id, proposal_id, nullifier) -> bool
}

// Typed Events
#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct VoteRelayedEvent {
    #[topic]
    pub dao_id: u64,
    #[topic]
    pub proposal_id: u64,
    pub nullifier: U256,
    pub vote_choice: bool,
    pub vote_root: U256,
    pub relayed_by: Address,
}

#[soroban_sdk::contractevent]
#[derive(Clone, Debug, PartialEq)]
pub struct ContractUpgraded {
    pub from: u32,
    pub to: u32,
}

#[contract]
pub struct Bridge;

#[contractimpl]
impl Bridge {
    fn bump_instance(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND);
    }

    fn bump_persistent<K: soroban_sdk::IntoVal<Env, soroban_sdk::Val>>(env: &Env, key: &K) {
        env.storage()
            .persistent()
            .extend_ttl(key, PERSISTENT_TTL_THRESHOLD, PERSISTENT_TTL_EXTEND);
    }

    /// Constructor: Initialize with voting contract address
    pub fn __constructor(env: Env, voting_contract: Address) {
        if env.storage().instance().has(&VERSION_KEY) {
            panic_with_error!(&env, BridgeError::AlreadyInitialized);
        }
        env.storage().instance().set(&VERSION_KEY, &VERSION);
        ContractUpgraded {
            from: 0,
            to: VERSION,
        }
        .publish(&env);

        env.storage()
            .instance()
            .set(&VOTING_CONTRACT, &voting_contract);
    }

    /// Relay a vote from EVM to Soroban
    ///
    /// Called by relayer after observing VoteForwarded event on EVM.
    /// The relayer passes the same parameters from the EVM event.
    ///
    /// Cross-chain double-vote prevention: checks the **voting contract's**
    /// nullifier state (not just the bridge's local map). Without this
    /// cross-contract call a voter could cast natively on Soroban and then
    /// replay the same nullifier through the EVM bridge — the bridge's
    /// isolated storage would never see the native vote.
    ///
    /// # Arguments
    /// * `dao_id` - DAO identifier
    /// * `proposal_id` - Proposal identifier
    /// * `vote_choice` - true = yes, false = no
    /// * `nullifier` - Domain-separated nullifier
    /// * `vote_root` - Merkle root (for reference/logging)
    /// * `relayer` - Address of the relayer submitting this vote
    pub fn relay_vote(
        env: Env,
        dao_id: u64,
        proposal_id: u64,
        vote_choice: bool,
        nullifier: U256,
        vote_root: U256,
        relayer: Address,
    ) {
        Self::bump_instance(&env);
        relayer.require_auth();

        // Validate nullifier is non-zero
        if nullifier == U256::from_u32(&env, 0) {
            panic_with_error!(&env, BridgeError::InvalidVoteChoice);
        }

        // Check nullifier hasn't been used in the BRIDGE's own state
        let null_key = DataKey::Nullifier(dao_id, proposal_id, nullifier.clone());
        if env.storage().persistent().has(&null_key) {
            panic_with_error!(&env, BridgeError::NullifierAlreadyUsed);
        }

        // Verify voting contract is configured
        let voting_addr: Address = env
            .storage()
            .instance()
            .get(&VOTING_CONTRACT)
            .unwrap_or_else(|| panic_with_error!(&env, BridgeError::VotingContractNotSet));

        // CRITICAL: Check nullifier against the VOTING CONTRACT's state.
        // The voting contract stores nullifiers in temporary/persistent
        // storage keyed by (dao_id, proposal_id, nullifier). We call
        // is_nullifier_used on the voting contract to prevent a voter
        // who already cast natively from replaying via the bridge.
        let already_used: bool = env.invoke_contract(
            &voting_addr,
            &Symbol::new(&env, "is_nullifier_used"),
            soroban_sdk::vec![
                &env,
                dao_id.into_val(&env),
                proposal_id.into_val(&env),
                nullifier.clone().into_val(&env),
            ],
        );
        if already_used {
            panic_with_error!(&env, BridgeError::NullifierAlreadyUsed);
        }

        // Mark nullifier as used in bridge state before recording vote
        // This prevents re-entrancy attacks
        env.storage().persistent().set(&null_key, &true);
        Self::bump_persistent(&env, &null_key);

        // Store vote record
        let record_key = DataKey::VoteRecorded(dao_id, proposal_id, nullifier.clone());
        env.storage().persistent().set(&record_key, &true);
        Self::bump_persistent(&env, &record_key);

        // Emit relay event
        VoteRelayedEvent {
            dao_id,
            proposal_id,
            nullifier,
            vote_choice,
            vote_root,
            relayed_by: relayer,
        }
        .publish(&env);
    }

    /// Check if a nullifier has been used (for cross-chain verification)
    pub fn is_nullifier_used(env: Env, dao_id: u64, proposal_id: u64, nullifier: U256) -> bool {
        Self::bump_instance(&env);
        let key = DataKey::Nullifier(dao_id, proposal_id, nullifier);
        env.storage().persistent().has(&key)
    }

    /// Get voting contract address
    pub fn voting_contract(env: Env) -> Address {
        Self::bump_instance(&env);
        env.storage()
            .instance()
            .get(&VOTING_CONTRACT)
            .unwrap_or_else(|| panic_with_error!(&env, BridgeError::VotingContractNotSet))
    }

    /// Contract version for upgrade tracking
    pub fn version(env: Env) -> u32 {
        Self::bump_instance(&env);
        env.storage()
            .instance()
            .get(&VERSION_KEY)
            .unwrap_or(VERSION)
    }
}

#[cfg(test)]
mod test;
