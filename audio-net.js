// Acoustic link UI. Encoding and decoding run in a Worker so the game loop stays smooth.
(function () {
    const SR = 44100;
    let enabled = false;
    let audioCtx = null;
    let micStream = null;
    let proc = null;
    let playGain = null;
    let worker = null;
    let beaconTimer = null;

    function myId() {
        return (typeof window.chat_myId === "string" && window.chat_myId) || "local";
    }

    function codec() {
        return window.AudioCodec;
    }

    function deliver(parsed) {
        if (!parsed) return;
        if (parsed.type === "peer") {
            if (!parsed.id || parsed.id === myId()) return;
            if (typeof window.noteAudioPeer === "function") window.noteAudioPeer(parsed.id);
            if (typeof window.ingestAudioPeer === "function") {
                window.ingestAudioPeer(parsed.id, {
                    x: parsed.x, y: parsed.y, lvl: parsed.lvl, hp: parsed.hp,
                    name: parsed.id, flipX: false, anim: "idle"
                });
            }
        } else if (parsed.type === "enemies" && typeof window.ingestAudioEnemies === "function") {
            window.ingestAudioEnemies(parsed.lvl, parsed.enemies);
        }
    }

    function playPcm(pcm) {
        if (!enabled || !audioCtx || !playGain || !pcm) return;
        const buf = audioCtx.createBuffer(1, pcm.length, SR);
        buf.getChannelData(0).set(pcm);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(playGain);
        src.start();
    }

    function ensureWorker() {
        if (worker) return worker;
        worker = new Worker("audio-worker.js?v=1.1.4");
        worker.onmessage = function (e) {
            const msg = e.data || {};
            if (!enabled) return;
            if (msg.type === "pcm") playPcm(msg.pcm);
            else if (msg.type === "packets" && msg.packets) {
                for (let i = 0; i < msg.packets.length; i++) deliver(codec().parsePacket(msg.packets[i]));
            }
        };
        return worker;
    }

    function sendBytes(bytes) {
        ensureWorker().postMessage({ type: "encode", bytes: Array.from(bytes) });
    }

    function beaconNow() {
        if (!enabled || !codec()) return;
        const pose = window.__audioPose || { lvl: 0, x: 0, y: 0, hp: 6 };
        sendBytes(codec().buildBeacon(myId(), pose));
        const enemies = window.__audioEnemies;
        if (pose.host && enemies && enemies.length) {
            setTimeout(function () {
                if (enabled) sendBytes(codec().buildEnemies(pose.lvl || 0, enemies));
            }, 900);
        }
    }

    let micHold = [];
    let micHoldLen = 0;

    function onMic(ev) {
        if (!worker) return;
        const input = ev.inputBuffer.getChannelData(0);
        const copy = new Float32Array(input.length);
        copy.set(input);
        micHold.push(copy);
        micHoldLen += copy.length;
        if (micHoldLen < SR * 0.3) return;
        const merged = new Float32Array(micHoldLen);
        let o = 0;
        for (let i = 0; i < micHold.length; i++) {
            merged.set(micHold[i], o);
            o += micHold[i].length;
        }
        micHold = [];
        micHoldLen = 0;
        worker.postMessage({ type: "mic", samples: merged.buffer }, [merged.buffer]);
    }

    async function enable() {
        if (enabled) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Prohlížeč neumí mikrofon nebo Web Audio");
        }
        audioCtx = new AC({ sampleRate: SR });
        if (audioCtx.state === "suspended") await audioCtx.resume();
        playGain = audioCtx.createGain();
        playGain.gain.value = 0.42;
        playGain.connect(audioCtx.destination);
        ensureWorker();
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
            video: false
        });
        const src = audioCtx.createMediaStreamSource(micStream);
        proc = audioCtx.createScriptProcessor(4096, 1, 1);
        proc.onaudioprocess = onMic;
        const mute = audioCtx.createGain();
        mute.gain.value = 0;
        src.connect(proc);
        proc.connect(mute);
        mute.connect(audioCtx.destination);
        enabled = true;
        window.__audioLinkOn = true;
        beaconNow();
        beaconTimer = setInterval(beaconNow, 2600);
        return true;
    }

    function disable() {
        enabled = false;
        window.__audioLinkOn = false;
        if (beaconTimer) clearInterval(beaconTimer);
        beaconTimer = null;
        if (proc) {
            proc.onaudioprocess = null;
            try { proc.disconnect(); } catch (e) {}
        }
        proc = null;
        if (micStream) micStream.getTracks().forEach(function (t) { t.stop(); });
        micStream = null;
        micHold = [];
        micHoldLen = 0;
        if (worker) {
            worker.onmessage = null;
            worker.terminate();
            worker = null;
        }
        if (audioCtx) {
            try { audioCtx.close(); } catch (e) {}
        }
        audioCtx = null;
        playGain = null;
    }

    function syncButton() {
        const btn = document.getElementById("audio-toggle");
        if (!btn) return;
        btn.classList.toggle("on", enabled);
        btn.setAttribute("aria-pressed", enabled ? "true" : "false");
        btn.title = enabled ? "Zvuková síť zapnutá" : "Zvuková síť vypnutá";
    }

    window.toggleAudioLink = async function () {
        try {
            if (enabled) disable();
            else await enable();
        } catch (err) {
            disable();
            const msg = (err && err.message) ? err.message : String(err);
            if (typeof window.logDebug === "function") window.logDebug("[AUDIO] " + msg, "error");
        }
        syncButton();
        return enabled;
    };

    window.AudioLink = {
        selfTest: function () {
            const C = codec();
            const cases = [];
            function check(name, pcm, expectCount, expectFirst) {
                const got = C.decodeAll(pcm).map(function (b) { return Array.from(b); });
                const ok = got.length === expectCount && (!expectFirst || JSON.stringify(got[0]) === JSON.stringify(expectFirst));
                cases.push({ name: name, ok: ok, count: got.length });
                return ok;
            }
            const beacon = C.buildBeacon("ab12cd", { lvl: 3, x: 420, y: 880, hp: 5 });
            let ok = check("clean", C.encodePacket(beacon), 1, beacon);
            const noisy = C.encodePacket(beacon);
            for (let i = 0; i < noisy.length; i++) noisy[i] += (Math.random() * 2 - 1) * 0.012;
            ok = check("noise", noisy, 1, beacon) && ok;
            const enemies = C.buildEnemies(1, [{ i: 2, x: 100, y: 200 }, { i: 4, x: 1500, y: 900 }]);
            ok = check("enemies", C.encodePacket(enemies), 1, enemies) && ok;
            const parsed = C.parsePacket(Uint8Array.from(beacon));
            const parseOk = parsed && parsed.type === "peer" && parsed.id === "ab12cd" && parsed.x === 420 && parsed.y === 880 && parsed.hp === 5;
            cases.push({ name: "parse", ok: !!parseOk });
            ok = !!parseOk && ok;
            return { ok: ok, cases: cases };
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        const btn = document.getElementById("audio-toggle");
        if (!btn) return;
        btn.addEventListener("click", function (e) {
            e.preventDefault();
            e.stopPropagation();
            window.toggleAudioLink();
        });
        syncButton();
    });
})();
