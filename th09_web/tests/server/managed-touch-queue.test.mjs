import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {createBrowserKeyboard} from '../../sdl-runtime/directory-keyboard.mjs';
import {exportReplayName, importReplayName} from '../../sdl-runtime/motion-replay.mjs';

// Source-level characterization, not a browser, native game, or latency test.
// Reuse managed-storage.test.mjs's VM/source-loading approach without its build
// or persistent-storage fixture. Keep the real message and lifecycle listeners.
// No test calls command(), dispatchCommand(), or writes the launched variable.
const sourceFiles = [
  ['managed', new URL('../../sdl-runtime/managed.mjs', import.meta.url)],
  ['keyboard', new URL('../../sdl-runtime/directory-keyboard.mjs', import.meta.url)],
  ['replay', new URL('../../sdl-runtime/motion-replay.mjs', import.meta.url)],
  ['test', new URL(import.meta.url)],
];
const sourceTexts = await Promise.all(sourceFiles.map(async ([name, url]) => [name, await readFile(url, 'utf8')]));
const sourceIdentity = Object.fromEntries(sourceTexts.map(([name, text]) =>
  [name, createHash('sha256').update(text).digest('hex')]));
const runtimeSource = sourceTexts.find(([name]) => name === 'managed')[1];
const runtimeBody = runtimeSource.replace(/^import .*;\r?\n/gm, '');
assert.ok(!/^import /m.test(runtimeBody), 'fixture must account for every module dependency');

const ORIGIN = 'https://managed-touch-queue.invalid';
const PROTOCOL = 'eagler-touhou/1';
const TRACE_LIMIT = 256, MESSAGE_LIMIT = 48, PUMP_LIMIT = 160;
const requireGoals = process.env.TH09_TOUCH_QUEUE_REQUIRE_GOALS === '1';
const touchOps = new Set(['touch', 'touch-controls', 'touch-stick', 'touch-cancel']);
const copy = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve, settled = false;
  const promise = new Promise(done => {resolve = done;});
  return {promise, release(value) {if (!settled) {settled = true;resolve(value);}}};
}

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(name, callback) {
      const list = listeners.get(name) || [];list.push(callback);listeners.set(name, list);
    },
    removeEventListener(name, callback) {
      listeners.set(name, (listeners.get(name) || []).filter(item => item !== callback));
    },
    dispatch(name, event = {}) {
      for (const callback of [...(listeners.get(name) || [])]) callback(event);
    },
    count(name) {return (listeners.get(name) || []).length;},
  };
}

function openRuntime({epoch = 73, holdModule = false} = {}) {
  const trace = [], replies = new Map(), emitted = [], jobs = [], gates = new Map();
  const window = eventTarget(), document = eventTarget(), body = eventTarget();
  const moduleGate = deferred();
  let clock = 0, messageSerial = 0, jobSerial = 0, bridge;
  let initializedDone = false, initializationError;
  document.hidden = false;
  const life = () => ({hidden: document.hidden, ...(bridge ? copy(bridge.state()) : {launched: false, stopping: false})});
  const note = (kind, fields = {}) => {
    assert.ok(trace.length < TRACE_LIMIT, 'bounded fixture trace overflow');
    const row = {seq: trace.length, fixtureAtMs: clock, kind, ...fields};trace.push(row);return row;
  };
  const native = (op, args) => note('native', {op, args: [...args], life: life()});
  const canvas = {...eventTarget(), getBoundingClientRect: () => ({left: 80, top: 60, width: 640, height: 480}),
    focus() {}, setPointerCapture() {}};
  body.setPointerCapture = () => {};
  document.body = body;
  const elements = new Map();
  document.querySelector = selector => {
    if (selector === 'canvas') return canvas;
    if (selector === 'meta[name="eagler-runtime-variant"]') return {content: 'multiplayer'};
    if (!elements.has(selector)) elements.set(selector, {textContent: ''});
    return elements.get(selector);
  };
  const files = new Set();
  const FS = {
    mkdirTree() {}, mount() {}, symlink(_target, path) {files.add(path);},
    syncfs(_populate, done) {done();},
    writeFile(path) {files.add(path);},
    analyzePath(path) {return {exists: files.has(path)};},
    unlink(path) {files.delete(path);},
  };
  const memory = new ArrayBuffer(4096);
  const core = {FS, IDBFS: {}, HEAPU8: new Uint8Array(memory), HEAP32: new Int32Array(memory), SDL3: {},
    _th09_title_status: () => 0, _th09_session_status: () => 32, _th09_touch_state: () => 64,
    _th09_error: () => 512, _th09_storage_revision: () => 0,
    _th09_prepare_loading: () => 1, _th09_save_snapshot: () => 1,
    _th09_game_open: () => {native('game-open', []);return 1;},
    _th09_game_close: () => native('game-close', []),
  };
  core.HEAP32[7] = 1; // Keep the unrelated title-exit branch inactive.
  core.HEAP32.set([1, 1, 0, 0], 16);
  for (const [name, op] of [
    ['touch', 'touch'], ['touch_cancel', 'touch-cancel'], ['touch_controls', 'touch-controls'],
    ['touch_stick', 'touch-stick'], ['touch_options', 'touch-options'], ['key', 'key'],
    ['keys_clear', 'keys-clear'], ['music_enabled', 'music'], ['loop_start', 'loop-start'],
    ['loop_pause', 'loop-pause'], ['loop_stop', 'loop-stop'],
  ]) core['_th09_' + name] = (...args) => native(op, args);

  const parent = {
    postMessage(message, origin) {
      assert.equal(origin, ORIGIN);
      const saved = copy(message);emitted.push(saved);
      note('response', {request: saved.request ?? null, event: saved.event ?? null, ok: saved.ok ?? null});
      if (typeof saved.request === 'string') {
        assert.ok(!replies.has(saved.request), 'duplicate command response: ' + saved.request);
        replies.set(saved.request, saved);
      }
    },
    async __eaglerPrepareManagedRuntimeDataV1(request) {
      assert.equal(request.game, 'th09');assert.equal(request.epoch, epoch);
      assert.equal(request.generation, 'fixture-generation');
      return {buffer: new ArrayBuffer(1000000)};
    },
  };
  function schedule(callback, delay = 0, kind = 'timer') {
    assert.ok(jobs.length < 16, 'fixture scheduling queue overflow');
    const id = ++jobSerial;
    jobs.push({id, callback, at: clock + Math.max(0, Number(delay) || 0), kind});return id;
  }
  const response = () => ({ok: true, arrayBuffer: async () => new ArrayBuffer(1),
    json: async () => ({builtAt: 'fixture-only'})});
  const fetch = async input => {
    const url = new URL(String(input), ORIGIN + '/runtime/th09/multiplayer/th09.html').href;
    const gate = gates.get(url);
    if (gate) {
      gate.started = true;note('resource-wait', {url});
      await gate.promise;note('resource-released', {url});
    }
    return response();
  };
  const context = {
    console, URL, URLSearchParams, Uint8Array, Int32Array, ArrayBuffer, TextDecoder, Promise, queueMicrotask,
    window, document, parent, innerWidth: 800, innerHeight: 600,
    location: {origin: ORIGIN, href: ORIGIN + '/runtime/th09/multiplayer/th09.html',
      search: '?managedData=1&runtimeEpoch=' + epoch + '&gameGeneration=fixture-generation'},
    performance: {now: () => clock, mark: name => note('mark', {name})},
    Date: {now: () => 1700000000000 + clock},
    requestAnimationFrame: callback => schedule(callback, 1000 / 60, 'raf'),
    setTimeout: (callback, delay) => schedule(callback, delay),
    clearTimeout: id => {const index = jobs.findIndex(job => job.id === id);if (index >= 0) jobs.splice(index, 1);},
    createBrowserKeyboard, exportReplayName, importReplayName, scanCodes: {KeyZ: 44},
    createModule: async () => {await moduleGate.promise;return core;},
    installStartupBranding: async () => {},
    SharedNetplay: class {constructor() {throw Error('transport is outside this fixture');}},
    fetch,
  };
  bridge = vm.runInNewContext('(function(){\n' + runtimeBody +
    '\nreturn {initialized, idle:()=>queue, state:()=>({launched,stopping,validEpoch})};\n})()', context,
    {filename: 'managed-touch-queue.vm.js', timeout: 1000});
  assert.equal(window.count('message'), 1, 'the real managed message listener must be present');
  assert.equal(window.count('blur'), 1, 'the real managed blur listener must be present');
  assert.equal(document.count('visibilitychange'), 1, 'the real managed visibility listener must be present');
  bridge.initialized.then(() => {initializedDone = true;}, error => {initializationError = error;initializedDone = true;});
  if (!holdModule) moduleGate.release();

  async function pumpUntil(predicate, {runTasks = false, label = 'condition'} = {}) {
    for (let turn = 0; turn < PUMP_LIMIT; turn++) {
      await Promise.resolve();
      if (predicate()) return;
      if (runTasks && jobs.length) {
        jobs.sort((a, b) => a.at - b.at || a.id - b.id);
        const job = jobs.shift();clock = Math.max(clock, job.at);job.callback(clock);
      }
    }
    throw Error('bounded fixture pump exhausted: ' + label);
  }
  async function idle() {
    let done = false, failure;
    bridge.idle().then(() => {done = true;}, error => {failure = error;done = true;});
    await pumpUntil(() => done, {label: 'managed queue settlement'});
    if (failure) throw failure;
  }
  function send(command, payload = {}, override = {}) {
    assert.ok(messageSerial < MESSAGE_LIMIT, 'bounded fixture message budget exceeded');
    const request = 'fixture-' + (++messageSerial);
    const data = {protocol: PROTOCOL, game: 'th09', epoch, command, ...payload, request, ...override.data};
    note('message', {request, command: data.command, claimedEpoch: data.epoch});
    window.dispatch('message', {source: Object.hasOwn(override, 'source') ? override.source : parent,
      origin: override.origin ?? ORIGIN, data});
    return request;
  }
  async function ready() {
    await pumpUntil(() => initializedDone, {label: 'managed initialization'});
    if (initializationError) throw initializationError;
    assert.ok(emitted.some(message => message.event === 'ready'));
  }
  function ok(request) {assert.equal(replies.get(request)?.ok, true, 'successful response: ' + request);}
  function noFatal() {assert.deepEqual(emitted.filter(message => message.event === 'error'), []);}
  async function launch(movement = 'touch') {
    await ready();
    const configured = send('configure', {options: {touchEnabled: true, touchMovementMode: movement, touchSensitivity: 150}, music: 'none'});
    await idle();ok(configured);
    const launched = send('launch');
    await pumpUntil(() => replies.has(launched), {runTasks: true, label: 'real launch command'});
    ok(launched);assert.equal(bridge.state().launched, true);noFatal();
  }
  function blockResource() {
    const url = ORIGIN + '/controlled-resource.bin', gate = deferred();
    assert.ok(!gates.has(url));gate.started = false;gates.set(url, gate);
    return {gate, request: send('resources', {resources: [{path: '/fonts/queue-fixture.bin', url}]})};
  }
  return {trace, replies, emitted, send, ready, launch, idle, pumpUntil, ok, noFatal, blockResource,
    state: life, releaseModule: () => moduleGate.release(),
    pending: requests => requests.filter(request => !replies.has(request)),
    blur() {note('lifecycle', {event: 'blur'});window.dispatch('blur');},
    hide() {document.hidden = true;note('lifecycle', {event: 'visibilitychange', hidden: true});document.dispatch('visibilitychange');},
    async close() {
      moduleGate.release();for (const gate of gates.values()) gate.release();
      // No real timers, device, network or browser exist. Settle pending VM work
      // under the same finite budget; never turn cleanup into an unbounded wait.
      for (let turn = 0; turn < PUMP_LIMIT; turn++) {
        await Promise.resolve();
        if (jobs.length) {const job = jobs.shift();clock = Math.max(clock, job.at);job.callback(clock);}
      }
      jobs.length = 0;
    },
  };
}

const rows = (runtime, start = 0) => runtime.trace.slice(start).filter(row => row.kind === 'native');
const inputs = (runtime, start = 0) => rows(runtime, start).filter(row => touchOps.has(row.op));
const shape = list => list.map(row => ({op: row.op, args: row.args}));
const down = {type: 'down', id: -1000000, x: .5, y: .5};
const move = {type: 'move', id: -1000000, x: .7, y: .6};
const controls = (extra = {}) => ({fireEnabled: true, focusEnabled: false, bombSerial: 0, escapeSerial: 0,
  joystickX: 0, joystickY: 0, touchSensitivity: 150, ...extra});

function report(t, name, runtime, start, observed, goals) {
  const nativeCalls = rows(runtime, start);
  assert.ok(nativeCalls.length <= 32, 'bounded evidence native trace');
  t.diagnostic(JSON.stringify({case: name, mode: 'characterization', requireGoals,
    scope: {boundary: 'real managed listener to stub native calls and parent ACK',
      gameProgressMeasured: false, realLatencyMeasured: false, realLauncherOrBrowser: false},
    clock: {name: 'fixture scheduling clock', timeOrigin: null, synthetic: true},
    sourceIdentity, observed, goals, nativeCalls}));
  if (requireGoals) for (const [name, passed] of Object.entries(goals)) assert.equal(passed, true, 'future repair property: ' + name);
}

test('real message listener rejects foreign envelopes and invalid Runtime epoch', async t => {
  const runtime = openRuntime();t.after(() => runtime.close());await runtime.launch();
  const start = runtime.trace.length;
  const rejected = [
    {source: {}}, {origin: 'https://foreign.invalid'}, {data: {protocol: 'wrong/1'}},
    {data: {game: 'th07'}}, {data: {epoch: 72}}, {data: {epoch: '73'}}, {data: {command: null}},
  ].map(override => runtime.send('direct-touch', down, override));
  await runtime.idle();
  assert.deepEqual(inputs(runtime, start), []);
  assert.deepEqual(runtime.pending(rejected), rejected);
  const accepted = runtime.send('direct-touch', down);await runtime.idle();runtime.ok(accepted);
  assert.deepEqual(shape(inputs(runtime, start)), [{op: 'touch', args: [0, -1000000, .5, .5]}]);
  const invalid = openRuntime({epoch: 0});t.after(() => invalid.close());await invalid.ready();
  const invalidStart = invalid.trace.length, invalidRequest = invalid.send('direct-touch', down);
  await invalid.idle();
  assert.equal(invalid.state().validEpoch, false);
  assert.deepEqual(inputs(invalid, invalidStart), []);
  assert.deepEqual(invalid.pending([invalidRequest]), [invalidRequest]);
  runtime.noFatal();invalid.noFatal();
  report(t, 'envelope-gates', runtime, start, {rejectedEnvelopeCount: rejected.length,
    invalidRuntimeEpochIgnored: true, acceptedNativeCalls: 1}, {envelopeGatesPreserved: true});
});

test('ready and launched input delivery is characterized while an unrelated resource awaits', async t => {
  const runtime = openRuntime();t.after(() => runtime.close());await runtime.launch();
  const start = runtime.trace.length, blocker = runtime.blockResource();
  await runtime.pumpUntil(() => blocker.gate.started, {label: 'controlled resource fetch entry'});
  const requests = [runtime.send('direct-touch', down), runtime.send('direct-touch', move),
    runtime.send('touch-controls', controls({focusEnabled: true})), runtime.send('touch-cancel'),
    runtime.send('touch-controls', controls())]; // The real host cancel also sends a neutral controls snapshot.
  const key = runtime.send('keyboard', {code: 'KeyZ', key: 'z', keyCode: 90, down: true});
  const cleared = runtime.send('keyboard-clear');
  await runtime.pumpUntil(() => runtime.replies.has(key) && runtime.replies.has(cleared), {label: 'keyboard bypass witness'});
  runtime.ok(key);runtime.ok(cleared);
  const before = {nativeInputCalls: inputs(runtime, start).length, unacknowledgedInputRequests: runtime.pending(requests).length,
    resourceAcknowledged: runtime.replies.has(blocker.request),
    keyboardNativeCalls: rows(runtime, start).filter(row => row.op === 'key' || row.op === 'keys-clear').length};
  assert.equal(before.resourceAcknowledged, false);assert.ok(before.keyboardNativeCalls >= 2);
  blocker.gate.release();await runtime.idle();runtime.ok(blocker.request);
  for (const request of requests) runtime.ok(request);
  assert.deepEqual(shape(inputs(runtime, start)), [
    {op: 'touch', args: [0, -1000000, .5, .5]}, {op: 'touch', args: [1, -1000000, .75, .625]},
    {op: 'touch-controls', args: [1, 1, 1, 0, 0]}, {op: 'touch-stick', args: [0, 0]},
    {op: 'touch-cancel', args: []}, {op: 'touch-controls', args: [1, 1, 0, 0, 0]}, {op: 'touch-stick', args: [0, 0]},
  ]);
  runtime.noFatal();
  report(t, 'active-resource-backlog', runtime, start, {workflow: 'ready-and-launched', inputMessages: requests.length, beforeRelease: before,
    classification: before.nativeInputCalls === 0 ? 'native-input-wait-reproduced'
      : before.nativeInputCalls === 7 ? 'all-input-calls-before-release' : 'partial-input-wait',
    afterRelease: {nativeInputCalls: inputs(runtime, start).length, unacknowledgedInputRequests: runtime.pending(requests).length}},
  {activeInputDoesNotAwaitUnrelatedResource: before.nativeInputCalls === 7});
});

test('queued direct input is classified against the real blur cancellation boundary', async t => {
  const runtime = openRuntime();t.after(() => runtime.close());await runtime.launch();
  const start = runtime.trace.length, blocker = runtime.blockResource();
  await runtime.pumpUntil(() => blocker.gate.started, {label: 'controlled resource fetch entry'});
  const requests = [runtime.send('direct-touch', down), runtime.send('direct-touch', move)];
  // This invokes the source's real lifecycle listener, not a synthetic native cancel.
  runtime.blur();
  const barrier = runtime.trace.findLast(row => row.kind === 'native' && row.op === 'touch-cancel').seq;
  assert.ok(barrier >= start);
  const before = {unacknowledgedInputRequests: runtime.pending(requests).length, cancelNativeSeq: barrier};
  blocker.gate.release();await runtime.idle();runtime.ok(blocker.request);
  const delivered = inputs(runtime, start).filter(row => row.op === 'touch');
  for (const request of requests) runtime.ok(request);
  assert.ok(delivered.length <= 2);
  for (const row of delivered) assert.deepEqual(row.args, row.args[0] === 0
    ? [0, -1000000, .5, .5] : [1, -1000000, .75, .625]);
  assert.equal(new Set(delivered.map(row => row.args[0])).size, delivered.length, 'no duplicate native delivery');
  assert.ok(delivered.every((row, index) => index === 0 || delivered[index - 1].args[0] < row.args[0]),
    'any retained direct inputs preserve DOWN before MOVE');
  const afterBarrier = delivered.filter(row => row.seq > barrier);
  runtime.noFatal();
  report(t, 'blur-barrier', runtime, start, {workflow: 'ready-and-launched-before-blur', beforeRelease: before,
    preBlurInputCallsAfterCancel: afterBarrier.length, unacknowledgedAfterRelease: runtime.pending(requests).length,
    classification: afterBarrier.length ? 'old-native-input-calls-after-cancel' : 'no-old-native-input-after-cancel',
    actualGestureRearmMeasured: false}, {noPreBarrierDirectInputCallsAfterBlur: afterBarrier.length === 0});
});

test('queued joystick controls are classified against the real hidden-document boundary', async t => {
  const runtime = openRuntime();t.after(() => runtime.close());await runtime.launch('joystick-free');
  const start = runtime.trace.length, blocker = runtime.blockResource();
  await runtime.pumpUntil(() => blocker.gate.started, {label: 'controlled resource fetch entry'});
  const request = runtime.send('touch-controls', controls({joystickX: 12000, joystickY: -9000}));
  runtime.hide();
  const barrier = runtime.trace.findLast(row => row.kind === 'native' && row.op === 'touch-cancel').seq;
  assert.ok(barrier >= start);
  const hiddenKey = runtime.send('keyboard', {code: 'KeyZ', key: 'z', keyCode: 90, down: true});
  await runtime.pumpUntil(() => runtime.replies.has(hiddenKey), {label: 'hidden keyboard response'});
  runtime.ok(hiddenKey);
  assert.equal(rows(runtime, barrier + 1).filter(row => row.op === 'key').length, 0, 'existing keyboard lifecycle gate');
  const before = {unacknowledgedInputRequests: runtime.pending([request]).length, hidden: runtime.state().hidden};
  blocker.gate.release();await runtime.idle();runtime.ok(blocker.request);
  const delivered = inputs(runtime, start).filter(row => row.op === 'touch-controls' || row.op === 'touch-stick');
  runtime.ok(request);
  assert.ok(delivered.length === 0 || delivered.length === 2);
  if (delivered.length) assert.deepEqual(shape(delivered), [
    {op: 'touch-controls', args: [1, 1, 0, 0, 0]}, {op: 'touch-stick', args: [12000, -9000]},
  ]);
  const hiddenCalls = delivered.filter(row => row.seq > barrier && row.life.hidden);
  runtime.noFatal();
  report(t, 'hidden-joystick-barrier', runtime, start, {workflow: 'ready-and-launched-before-hidden', beforeRelease: before,
    oldControlNativeCallsWhileHidden: hiddenCalls.length, unacknowledgedAfterRelease: runtime.pending([request]).length,
    actualMovementOrCaptureMeasured: false}, {noPreBarrierJoystickCallsWhileHidden: hiddenCalls.length === 0});
});

test('adversarial same-epoch pre-ready input records initialization and launch eligibility separately', async t => {
  const runtime = openRuntime({holdModule: true});t.after(() => runtime.close());
  const start = runtime.trace.length;
  const requests = [runtime.send('direct-touch', down), runtime.send('touch-controls', controls({joystickX: 1000}))];
  for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  assert.deepEqual(inputs(runtime, start), [], 'no native access while createModule is unresolved');
  const before = {nativeInputCalls: 0, unacknowledgedInputRequests: runtime.pending(requests).length};
  runtime.releaseModule();await runtime.ready();await runtime.idle();
  for (const request of requests) runtime.ok(request);
  assert.equal(runtime.state().launched, false);
  const preLaunchCalls = inputs(runtime, start).filter(row => !row.life.launched);
  runtime.noFatal();
  report(t, 'adversarial-pre-ready', runtime, start, {workflow: 'adversarial-valid-envelope',
    normalLauncherWouldSendBeforeReady: false, beforeModuleRelease: before,
    nativeInputCallsBeforeLaunch: preLaunchCalls.length, unacknowledgedAfterInitialization: runtime.pending(requests).length,
    actualGameplayMeasured: false}, {noPreReadyInputDeliveredAfterInitializationWithoutLaunch: preLaunchCalls.length === 0});
});

test('characterization records the unchanged source bytes it actually evaluated', async t => {
  const current = await Promise.all(sourceFiles.map(async ([name, url]) => [name,
    createHash('sha256').update(await readFile(url, 'utf8')).digest('hex')]));
  assert.deepEqual(Object.fromEntries(current), sourceIdentity);
  t.diagnostic(JSON.stringify({sourceIdentity, sourceStable: true, requireGoals,
    resultMeaning: 'PASS validates the fixture contracts and records risks; it is not a fastpath, native-game, mobile, latency, or FPS acceptance',
    futureGate: 'TH09_TOUCH_QUEUE_REQUIRE_GOALS=1 requires all separately reported repair properties'}));
});

