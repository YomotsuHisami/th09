# TH09 multiplayer general-rules applicability audit

Date: 2026-10-02 (UTC)

## Result

TH09's multiplayer product is a **two-human competitive versus match on two
opposing fields**. It does not have the cooperative shared-field life, bomb,
gift-revival or team-boss model used by the other titles in this overhaul.
No gameplay, input, rollback, replay, resource, difficulty or boss source was
changed. This work adds executable regression coverage and makes the scope
decision explicit.

Base: `experiment/th09-multiplayer`,
`5b9305c823940b028735dbc425ee19237e5f5905`.
Audit worktree branch: `experiment/rules-20261002`.
The shared `eagler-common` source remains pinned at
`ac82fa2f6e85b6eac1e1abb2c775a04f533ea5da`.
Nothing was published, merged or deployed.

## Evidence and applicability matrix

| Proposed cross-title rule | Actual TH09 semantics | Decision and evidence |
| --- | --- | --- |
| Gift a life to revive a teammate | Fatal damage awards the **opponent** a round; versus rounds count toward a winning threshold. No cooperative downed teammate exists. | Not applicable to this product. `PlayerLife.cpp:5–24`, `MatchScene.cpp:14–22,50–62`; executable tests cover both losing sides, duplicate collisions, round retry and match completion. |
| Set ordinary-death bomb stock to one | `ShotControlState` holds a floating-point charge gauge. X requires at least 200 gauge, sends a charge attack, and spends gauge. There is no corresponding bomb-stock field. | Not applicable. `ShotControl.hpp:6–10`, `ShotControl.cpp:49–57`. Tests cover 0/100/199/200/299/300/399/400 gauge, both boss-slot states, held input, scene lock, recovery and no input. |
| Scale cooperative resource quantities | There are four field-local item kinds: charge (+400), attack transfers, character combo (+400), score (+70000). The global reward event creates one matching reward enemy per opposing field. Versus score does not generate campaign extra lives. | Preserve native rewards, not teammate-shared drop multipliers. `PlayerItems.cpp:16–30`, `MatchRules.cpp:14–18,62–69`, `GameBattle.cpp:94–98`. Tests execute all four kinds on both fields under each existing network difficulty setting. |
| Dynamically downgrade shared boss HP when a player leaves/dies | Bosses are attacks sent into the opponent's field, with a per-field boss slot and countering behavior. `AttackController::begin` initially creates boss-script enemies at 1400 HP. Subsequent character ECL behavior remains authoritative. | Shared-team boss scaling does not apply. `AttackController.hpp:27–29`, `AttackController.cpp:4–22`. Tests cover destination field, initial HP, attacking-player ownership and duplicate-slot refusal. They do not assert every ECL boss stays at 1400 HP. |
| Preserve deterministic multiplayer and replay | The current branch uses rollback over the two-player versus world. `WorldState::Save` rejects a missing world, replay mode and any mode other than versus. Its inventory contains health/charge/item/life state, rules, rounds and recording state. | Applicable invariant, unchanged. `WorldState.cpp:77–83,101–119`; existing executable rollback/component gates rerun. Full-world retail-asset replay was not rerun. |
| Avoid new difficulty tiers or invented spell-specific balance | Existing original difficulty settings and existing character mechanics remain present. No new multiplayer tier, coefficient, spell exception or character-specific balance was introduced. | No gameplay modification. The Tewi automatic-defence regression checks an already-existing rule rather than adding one. |

### Network entry really launches versus

`Application.cpp:304–319` sets network mode and starts the room match.
`TitleMenus.hpp:81–83` routes that match through `launch(true, -1)`.
`TitleCharacters.cpp:33–38` sets `GameMode::versus` and gives both network seats
human controllers. `MatchRules.hpp:5` names the available modes as story,
extra and versus. There is no separate cooperative TH09 mode in this source.
These entry-path observations are **source inspection**, not a new browser
launch test.

The older general README and a shared playbook still describe lockstep; that
description is historical for this experiment. `RollbackSession.cpp`,
`Application.cpp` and the branch's `AGENT-HANDOFF.md` establish the actual
rollback implementation. This audit did not broaden into documentation cleanup.

## HIGH RISK ledger: inferred scope decisions

Every inferred rule/scope decision in this audit is listed here as **HIGH RISK**,
even though no gameplay change was made. The source facts in the matrix are
observations, not newly authorized product requirements.

| ID | Inferred decision | Status | Risk / what would require an explicit new decision |
| --- | --- | --- | --- |
| HR09-01 — HIGH RISK | Interpret the general multiplayer request for TH09 as retaining its current competitive product; do not invent teammate gift revival. | Applied as a no-change boundary; competitive outcomes tested. | A request for a new cooperative TH09 mode would need its own team, death, revival and victory design. It cannot safely be inferred from a cross-title overhaul. |
| HR09-02 — HIGH RISK | Do not translate `Bomb1` or cooperative drop multipliers into charge-gauge resets or native item multipliers. | No charge/resource source changes; threshold and reward regressions added. | Such a translation would materially change offensive/defensive charge economics and versus fairness. |
| HR09-03 — HIGH RISK | Do not apply active-team-count boss HP downgrade to opponent-owned boss attacks. | No boss/ECL source changes; field/slot/initial-HP regressions added. | A shared boss/team roster does not exist in this product. The intended scaling model would need a new product decision. |
| HR09-04 — HIGH RISK | Preserve native difficulty-dependent simulation while adding no new multiplayer difficulty tiers. | No difficulty source or configuration change. | Removing existing title difficulties would change original versus and replay semantics, and is not inferred from “no new difficulty tiers.” |

## Changed files

- `th09_web/tests/multiplayer/versus-rules.cpp`: directly executes existing
  production C++ rule owners with existing test service fixtures; no source-text
  regex is used as a substitute for behavior.
- `th09_web/tests/multiplayer/versus-rules.mjs`: asset-free WASI build/run and
  source/header/compiler fingerprint report.
- `th09_web/package.json`: adds `npm run test:rules`.
- `th09_web/tests/server/managed-storage.test.mjs`: repairs the test VM's missing
  keyboard import by loading the real generated package helper. Runtime code
  and storage behavior are unchanged.
- This report.

## Executable verification

### Passed

1. `WASI_SDK_BIN=<WASI SDK 34 bin> npm run test:rules`
   - 334 assertions across the scenarios above.
   - Builds production `ShotControl`, `PlayerLife`, `PlayerHazards`,
     `AttackAreas`, `PlayerCollision`, `PlayerItems`, `MatchRules`,
     `AttackController`, `MatchScene`, `StageSelection`, RNG, timer and math.
   - Records asset-free component scope and source/header fingerprints in the
     ignored `th09_web/artifacts/multiplayer-tests/versus-rules-report.json`.
   - The expectations preserve the checked-in native rules. This is not a fresh
     comparison against an original executable or original character resources.

2. `WASI_SDK_BIN=<WASI SDK 34 bin> npm run test:rollback`
   - Frame scheduling: ordinary cadence, one pending retry, no accumulated stall
     debt, budget and pause/restart.
   - ABI gate, zero-frame local delay, once-only input capture and input bounds.
   - Five 600-frame session/fault modes passed. Mode 0: 377/0 corrections;
     mode 1: 272/272; mode 2: 266/266; mode 3: 87/87; mode 4: 281/281.
   - Owning ECL copy/context rebinding/delete-reuse/transient-pointer rejection.
   - Effect ownership, animation/burst deletion, vector reuse and empty restore.
   - All nine polymorphic attack-state kinds and child-parent restoration.
   - 600 exact full-pool bullet restore/replay/reset/reuse/overflow cases.
   - Production attack constructors/checkpoint adapters compile without RTTI.

3. `node --test tests/server/shared-netplay.test.mjs`
   - Five transport-adapter/lifecycle tests passed: shared room transport,
     delay-to-native plumbing, rollback diagnostics and terminal ACKs, independent
     replay-save exit, confirmed spectator frames with invalid motion rejection.
   - The JS transport/core fixtures are mocked; this is not real WebRTC/browser
     or full-world replay evidence.

4. `TH09_EMSDK=<Emscripten SDK> npm run web:build`
   - Fresh production release compiled all 114 translation units and linked.
   - `th09.wasm`: 2,794,422 bytes, SHA-256
     `9b46a4f4b6db06553c0e455f9130f4ad0f0d88e96c0fc7934df7060b0e86c299`.
   - The release export guard passed; development probe exports are absent.
   - Existing SDL3 experimental-port and third-party `stb_vorbis` comparison
     warnings remain. This is a source build, not an asset-complete game package.

5. `node --test tests/server/managed-storage.test.mjs tests/server/shared-netplay.test.mjs`
   - All six tests passed together after the test-fixture repair.
   - The storage gate generates both actual package variants against the fresh
     release ABI and executes their shell storage commands using in-memory
     filesystem/IDBFS fixtures. Normal `/savesth09` and multiplayer `/savesth09mp`
     remain separate across write, sync, reload and MP replay deletion.
   - This proves shell storage ownership in that fixture, not real browser
     IndexedDB persistence or replay simulation.
   - The initial attempt was blocked by absent local release WASM. After the
     fresh build, it exposed a pre-existing harness failure:
     `createBrowserKeyboard is not defined`. The VM removes import lines but had
     not supplied the newly required helper. The repair imports that exact
     helper from the generated package rather than weakening the test or
     changing production code.

6. `git diff --check`: passed.

### Not run / no claim

- Original executable/resource oracle tests (`npm test`), archive oracle and
  full-world built-in/demo/long replay: original assets are absent from this
  source-only worktree.
- Real browser/RTC/relay/spectator gameplay, physical devices, mobile behavior,
  performance/latency and subjective play balance.
- Any new cooperative TH09 mode, gift algorithm, shared boss scaling or
  character/spell rebalance.

No retail assets, original executable, saves, user replays or private logs were
added to the deliverable.
