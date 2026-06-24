import * as anchor from "@coral-xyz/anchor";
import { PublicKey, Keypair, ComputeBudgetProgram, SystemProgram } from "@solana/web3.js";
import { assert } from "chai";
import { readFileSync, existsSync } from "fs";
import BN from "bn.js";

const Q =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n;

function be32(dec: string | bigint): number[] {
  let v = BigInt(dec);
  const out = new Array(32).fill(0);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

const neg = (s: string | bigint) => (Q - (BigInt(s) % Q)) % Q;

const idl = JSON.parse(readFileSync("target/idl/soteria_verifier.json", "utf8"));

function u64le(n: number | bigint): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

function poolPda(programId: PublicKey, poolId: number): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("pool"), u64le(poolId)], programId)[0];
}
function vaultPda(programId: PublicKey, poolId: number): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), u64le(poolId)], programId)[0];
}
function commitmentPda(programId: PublicKey, pool: PublicKey, commitment: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("commit"), pool.toBuffer(), Buffer.from(commitment)],
    programId
  )[0];
}
function poolNullifierPda(programId: PublicKey, pool: PublicKey, nh: number[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_null"), pool.toBuffer(), Buffer.from(nh)],
    programId
  )[0];
}
function root(byte: number): number[] {
  const r = new Array(32).fill(0);
  r[31] = byte;
  return r;
}

const DENOM = new BN(100_000_000); // 0.1 SOL

describe("soteria pool", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = new anchor.Program(idl as anchor.Idl, provider);

  let poolId = 1000;
  const nextPool = () => poolId++;

  async function createPool(id: number) {
    await program.methods
      .initPool(new BN(id), DENOM)
      .accounts({
        authority: provider.wallet.publicKey,
        pool: poolPda(program.programId, id),
        vault: vaultPda(program.programId, id),
      })
      .rpc();
  }

  it("creates a fixed-denomination pool", async () => {
    const id = nextPool();
    await createPool(id);
    const acct = await program.account.pool.fetch(poolPda(program.programId, id));
    assert.equal(acct.poolId.toNumber(), id);
    assert.equal(acct.denomination.toString(), DENOM.toString());
    assert.equal(acct.numCommitments.toNumber(), 0);
    assert.ok(acct.authority.equals(provider.wallet.publicKey));
  });

  it("rejects a zero denomination", async () => {
    const id = nextPool();
    try {
      await program.methods
        .initPool(new BN(id), new BN(0))
        .accounts({
          authority: provider.wallet.publicKey,
          pool: poolPda(program.programId, id),
          vault: vaultPda(program.programId, id),
        })
        .rpc();
      assert.fail("expected ZeroDenomination");
    } catch (e) {
      assert.match((e as Error).toString(), /ZeroDenomination/);
    }
  });

  it("accepts a deposit, anchors its commitment, and funds the vault", async () => {
    const id = nextPool();
    await createPool(id);
    const pool = poolPda(program.programId, id);
    const vault = vaultPda(program.programId, id);
    const commitment = be32(12345n);

    const before = await provider.connection.getBalance(vault);
    await program.methods
      .deposit(commitment)
      .accounts({
        depositor: provider.wallet.publicKey,
        pool,
        vault,
        commitmentRecord: commitmentPda(program.programId, pool, commitment),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const after = await provider.connection.getBalance(vault);
    assert.equal(after - before, DENOM.toNumber());

    const acct = await program.account.pool.fetch(pool);
    assert.equal(acct.numCommitments.toNumber(), 1);

    const rec = await program.account.commitment.fetch(
      commitmentPda(program.programId, pool, commitment)
    );
    assert.equal(rec.leafIndex.toNumber(), 0);
    assert.deepEqual(rec.commitment, commitment);
  });

  it("rejects a duplicate commitment", async () => {
    const id = nextPool();
    await createPool(id);
    const pool = poolPda(program.programId, id);
    const vault = vaultPda(program.programId, id);
    const commitment = be32(777n);
    const accounts = {
      depositor: provider.wallet.publicKey,
      pool,
      vault,
      commitmentRecord: commitmentPda(program.programId, pool, commitment),
      systemProgram: SystemProgram.programId,
    };

    await program.methods.deposit(commitment).accounts(accounts).rpc();
    try {
      await program.methods.deposit(commitment).accounts(accounts).rpc();
      assert.fail("expected the duplicate commitment to fail at init");
    } catch (e) {
      assert.match((e as Error).toString(), /already in use|custom program error/i);
    }
  });

  it("publishes deposit roots and sets the association root (authority only)", async () => {
    const id = nextPool();
    await createPool(id);
    const pool = poolPda(program.programId, id);

    await program.methods
      .publishPoolRoot(root(7))
      .accounts({ authority: provider.wallet.publicKey, pool })
      .rpc();
    await program.methods
      .setAssociationRoot(root(8))
      .accounts({ authority: provider.wallet.publicKey, pool })
      .rpc();

    const acct = await program.account.pool.fetch(pool);
    assert.equal(acct.rootCount.toNumber(), 1);
    assert.deepEqual(acct.roots[0], root(7));
    assert.deepEqual(acct.associationRoot, root(8));
  });

  it("rejects root publishing from a non-authority", async () => {
    const id = nextPool();
    await createPool(id);
    const pool = poolPda(program.programId, id);
    const stranger = Keypair.generate();
    try {
      await program.methods
        .publishPoolRoot(root(3))
        .accounts({ authority: stranger.publicKey, pool })
        .signers([stranger])
        .rpc();
      assert.fail("expected has_one violation");
    } catch (e) {
      assert.match((e as Error).toString(), /has_one|ConstraintHasOne|unknown signer/i);
    }
  });

  // Full withdraw path — needs the pool trusted setup (scripts/setup-pool.sh)
  // and a pre-generated proof. Skips automatically when absent.
  const proofPath = "circuits/build/withdraw_proof.json";
  const publicPath = "circuits/build/withdraw_public.json";
  const maybeIt =
    existsSync(proofPath) && existsSync(publicPath) ? it : it.skip;

  maybeIt("withdraws with a valid proof and blocks double-spend", async () => {
    const proof = JSON.parse(readFileSync(proofPath, "utf8"));
    const pub: string[] = JSON.parse(readFileSync(publicPath, "utf8"));
    // pub = [nullifierHash, depositRoot, associationRoot, recipientHi, recipientLo, fee]
    const proofA = [...be32(proof.pi_a[0]), ...be32(neg(proof.pi_a[1]))];
    const proofB = [
      ...be32(proof.pi_b[0][1]), ...be32(proof.pi_b[0][0]),
      ...be32(proof.pi_b[1][1]), ...be32(proof.pi_b[1][0]),
    ];
    const proofC = [...be32(proof.pi_c[0]), ...be32(proof.pi_c[1])];
    const publicInputs = pub.map((s) => be32(s));
    const fee = new BN(pub[5]);
    const cu = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });

    // The proof's recipient binding (pub[3]/pub[4]) must be the recipient passed
    // here; the generator script writes the matching keypair alongside.
    const recipient = new PublicKey(
      JSON.parse(readFileSync("circuits/build/withdraw_recipient.json", "utf8"))
    );

    const id = nextPool();
    await createPool(id);
    const pool = poolPda(program.programId, id);
    const vault = vaultPda(program.programId, id);

    // fund the vault by depositing the note's commitment
    const commitment = be32(JSON.parse(readFileSync("circuits/build/withdraw_commitment.json", "utf8")));
    await program.methods
      .deposit(commitment)
      .accounts({
        depositor: provider.wallet.publicKey,
        pool,
        vault,
        commitmentRecord: commitmentPda(program.programId, pool, commitment),
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await program.methods
      .publishPoolRoot(be32(pub[1]))
      .accounts({ authority: provider.wallet.publicKey, pool })
      .rpc();
    await program.methods
      .setAssociationRoot(be32(pub[2]))
      .accounts({ authority: provider.wallet.publicKey, pool })
      .rpc();

    const nullifier = poolNullifierPda(program.programId, pool, be32(pub[0]));
    const accounts = {
      relayer: provider.wallet.publicKey,
      pool,
      vault,
      recipient,
      nullifier,
      systemProgram: SystemProgram.programId,
    };

    const before = await provider.connection.getBalance(recipient);
    await program.methods
      .withdraw(proofA, proofB, proofC, publicInputs, fee)
      .accounts(accounts)
      .preInstructions([cu])
      .rpc();
    const after = await provider.connection.getBalance(recipient);
    assert.equal(after - before, DENOM.toNumber() - fee.toNumber());

    // replay with the same nullifier fails at account init
    try {
      await program.methods
        .withdraw(proofA, proofB, proofC, publicInputs, fee)
        .accounts(accounts)
        .preInstructions([cu])
        .rpc();
      assert.fail("expected double-spend to fail");
    } catch (e) {
      assert.match((e as Error).toString(), /already in use|custom program error/i);
    }
  });
});
