// Phase 4 verification: deposit (client-signed + /deposit-notify) and a private
// pay (/relay) routed through the SERVER, not direct program calls.
import { readFileSync } from "fs";
import { Connection, Keypair, Transaction, ComputeBudgetProgram } from "@solana/web3.js";
import { shielded, zk } from "@soteria1/sdk";
const RPC="https://api.devnet.solana.com", SERVER="http://127.0.0.1:8787", ID=5;
const WASM="circuits/build/transaction_js/transaction.wasm", ZKEY="circuits/build/transaction_final.zkey";
const conn=new Connection(RPC,"confirmed");
const funder=Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(process.env.FUNDER,"utf8"))));
const post=(p,b)=>fetch(SERVER+p,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b)}).then(async r=>{const j=await r.json();if(!r.ok)throw new Error(p+": "+JSON.stringify(j));return j;});
const get=(p)=>fetch(SERVER+p).then(r=>r.json());
const sol=(n)=>Number(n)/1e9;
const rebuild=async(recs)=>{const s=[...recs].sort((a,b)=>a.leafIndex-b.leafIndex);const t=await zk.PoseidonMerkleTree.create(20);t.insertMany(s.map(r=>BigInt(r.commitment)));return t;};
const rndSeed=()=>{const b=new Uint8Array(64);globalThis.crypto.getRandomValues(b);return b;};
const scan=async(id)=>{const st=await get(`/shielded/${ID}`);const owned=await shielded.scanOutputs(st.records.map(r=>({commitment:BigInt(r.commitment),encryptedSecret:r.encryptedSecret,leafIndex:r.leafIndex})),id);const spent=new Set(st.spentNullifiers);const be32=(v)=>{const o=new Array(32).fill(0);let x=v;for(let i=31;i>=0;i--){o[i]=Number(x&0xffn);x>>=8n;}return o;};return owned.filter(n=>!spent.has(be32(n.nullifier).join(",")));};

const alice=await shielded.deriveShieldedKeypair(rndSeed());
const bob=await shielded.deriveShieldedKeypair(rndSeed());

// DEPOSIT 0.04 (client-signed) -> /deposit-notify
const D=40_000_000n;
let st=await get(`/shielded/${ID}`);
let root=st.root?BigInt(st.root):0n;
const depTx=await shielded.buildTransaction({inputs:[],outputs:[{note:shielded.newNote(D,alice.publicKey),encPub:alice.encPub}],spendKeypair:alice,extAmount:D,fee:0n,recipient:funder.publicKey,relayer:funder.publicKey,root,wasmPath:WASM,zkeyPath:ZKEY});
const ix=shielded.transactInstruction({shieldedId:ID,signer:funder.publicKey,recipient:funder.publicKey,relayer:funder.publicKey,tx:depTx,extAmount:D,fee:0n});
const t=new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({units:1_400_000}),ix);
t.feePayer=funder.publicKey; t.recentBlockhash=(await conn.getLatestBlockhash()).blockhash; t.sign(funder);
const sig=await conn.sendRawTransaction(t.serialize()); await conn.confirmTransaction(sig,"confirmed");
await post(`/shielded/${ID}/deposit-notify`,{signature:sig,commitments:depTx.outputCommitments.map(String),encryptedSecrets:depTx.encryptedSecrets,nullifiers:[depTx.publicInputs[3],depTx.publicInputs[4]]});
let aliceNotes=await scan(alice);
console.log("→ DEPOSIT via /deposit-notify: Alice balance", sol(shielded.balance(aliceNotes)), "SOL", shielded.balance(aliceNotes)===D?"✓":"✗");

// PAY Bob 0.015 (fee 0.001) via /relay
const pay=15_000_000n, fee=1_000_000n, change=D-pay-fee;
st=await get(`/shielded/${ID}`); const relayer=new (await import("@solana/web3.js")).PublicKey(st.relayer);
const tree=await rebuild(st.records); const aIn=aliceNotes[0]; const pr=tree.proof(aIn.leafIndex);
const payTx=await shielded.buildTransaction({inputs:[{note:{amount:aIn.amount,pubkey:aIn.pubkey,blinding:aIn.blinding},pathElements:pr.pathElements,pathIndices:pr.pathIndices}],outputs:[{note:shielded.newNote(pay,bob.publicKey),encPub:bob.encPub},{note:shielded.newNote(change,alice.publicKey),encPub:alice.encPub}],spendKeypair:alice,extAmount:0n,fee,recipient:relayer,relayer,root:BigInt(st.root),wasmPath:WASM,zkeyPath:ZKEY});
await post(`/shielded/${ID}/relay`,{proof:{proofA:payTx.proofA,proofB:payTx.proofB,proofC:payTx.proofC,publicInputs:payTx.publicInputs,nullifiers:[payTx.publicInputs[3],payTx.publicInputs[4]]},extAmount:"0",fee:fee.toString(),recipient:relayer.toBase58(),outputs:{commitments:payTx.outputCommitments.map(String),encryptedSecrets:payTx.encryptedSecrets}});
const bobNotes=await scan(bob);
console.log("→ PAY via /relay: Bob received", sol(shielded.balance(bobNotes)), "SOL", shielded.balance(bobNotes)===pay?"✓":"✗");
const ok=shielded.balance(aliceNotes)===D && shielded.balance(bobNotes)===pay;
console.log(ok?"\n✅ PHASE 4 PASSED — deposit + private pay routed through the server":"\n❌ FAILED");
process.exit(ok?0:1);
