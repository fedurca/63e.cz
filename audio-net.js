// Soft fifth, both devices at once, pose five times a second.
(function () {
    const SR = 44100;
    let enabled = false;
    let audioCtx = null;
    let micStream = null;
    let proc = null;
    let playGain = null;
    let worker = null;
    let pumpTimer = null;
    let statTimer = null;
    let nextAt = 0;
    let rootPhase = 0;
    let bank = 0;
    let seqOk = null;
    let lastPose = null;
    let txThisSec = 0;
    let rxThisSec = 0;
    let lastRxAt = 0;
    let micHold = [];
    let micHoldLen = 0;
    const peers = new Map();
    const ui = {
        mic: 0, e0: 0, e1: 0, tx: "—", rx: "čekám", peer: "", err: ""
    };

    function myId() {
        return (typeof window.chat_myId === "string" && window.chat_myId) || "local";
    }
    function codec() { return window.AudioCodec; }

    function bankOf(id) {
        let h = 2166136261;
        const s = String(id || "");
        for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
        return (h >>> 0) % 2;
    }

    function audioLog(msg) {
        ui.rx = msg;
        if (typeof window.logDebug === "function") window.logDebug("[AUDIO] " + msg, "webrtc", myId());
        renderDebug();
    }

    function renderDebug() {
        const box = document.getElementById("audio-debug");
        if (!box) return;
        box.hidden = !enabled;
        const name = codec() ? codec().BANKS[bank].name : "?";
        const lines = [
            enabled ? "Tichý akord " + name + ", 5×/s" : "Zvuková síť vypnutá",
            "Mikrofon: " + ui.mic.toFixed(3),
            "Slyším C " + ui.e0.toExponential(1) + "  G " + ui.e1.toExponential(1),
            "TX: " + ui.tx,
            "RX: " + ui.rx,
            "Soused: " + (ui.peer || "nikdo")
        ];
        if (ui.err) lines.push(ui.err);
        box.textContent = lines.join("\n");
    }

    function acceptPose(pose) {
        if (!pose || !pose.id || pose.id === myId()) return;
        const now = Date.now();
        if (!seqOk || seqOk.id !== pose.id) {
            seqOk = { id: pose.id, n: 1 };
            return;
        }
        seqOk.n = (seqOk.n || 1) + 1;
        if (seqOk.n < 2 || now - lastRxAt < 160) return;
        if (lastPose && lastPose.id === pose.id) {
            const dx = pose.x - lastPose.x;
            const dy = pose.y - lastPose.y;
            if (dx * dx + dy * dy > 700 * 700) return;
        }
        lastPose = pose;
        lastRxAt = now;
        rxThisSec++;
        peers.set(pose.id, now);
        ui.peer = pose.id + " @" + pose.x + "," + pose.y + " hp" + pose.hp;
        if (typeof window.noteAudioPeer === "function") window.noteAudioPeer(pose.id);
        if (typeof window.ingestAudioPeer === "function") {
            window.ingestAudioPeer(pose.id, {
                x: pose.x, y: pose.y, lvl: pose.lvl, hp: pose.hp,
                name: pose.id, flipX: false, anim: "idle"
            });
        }
        if (bankOf(pose.id) === bank && pose.id > myId()) {
            bank ^= 1;
            audioLog("stejné pásmo, přepínám na " + codec().BANKS[bank].name);
        }
        renderDebug();
    }

    function onHeard(msg) {
        ui.mic = ui.mic * 0.5 + (msg.rms || 0) * 0.5;
        const banks = msg.banks || [];
        for (let i = 0; i < banks.length; i++) {
            if (banks[i].bank === 0) ui.e0 = banks[i].energy || 0;
            if (banks[i].bank === 1) ui.e1 = banks[i].energy || 0;
            if (!banks[i].confident) continue;
            const pose = codec().unpackPose(banks[i].symbols);
            if (pose) acceptPose(pose);
        }
        renderDebug();
    }

    function ensureWorker() {
        if (worker) return worker;
        worker = new Worker("audio-worker.js?v=1.1.6");
        worker.onmessage = function (e) {
            if (!enabled) return;
            const msg = e.data || {};
            if (msg.type === "heard") onHeard(msg);
        };
        worker.onerror = function () { ui.err = "worker"; audioLog("worker chyba"); };
        return worker;
    }

    function pump() {
        if (!enabled || !audioCtx || !codec()) return;
        const C = codec();
        if (nextAt < audioCtx.currentTime + 0.05) nextAt = audioCtx.currentTime + 0.06;
        while (nextAt < audioCtx.currentTime + 0.32) {
            const pose = window.__audioPose || { x: 0, y: 0, hp: 6, lvl: 0 };
            const symbols = C.packPose(myId(), pose);
            const built = C.encodeFrame(bank, symbols, rootPhase);
            rootPhase = built.rootPhase;
            const buf = audioCtx.createBuffer(1, built.pcm.length, SR);
            buf.getChannelData(0).set(built.pcm);
            const src = audioCtx.createBufferSource();
            src.buffer = buf;
            src.connect(playGain);
            src.start(nextAt);
            nextAt += built.pcm.length / SR;
            txThisSec++;
            ui.tx = myId() + " @" + Math.round(pose.x) + "," + Math.round(pose.y) + " hp" + (pose.hp || 0) + " " + C.BANKS[bank].name;
        }
    }

    function resample(input, fromRate) {
        if (!fromRate || Math.abs(fromRate - SR) < 50) return input;
        const n = Math.max(1, Math.round(input.length * SR / fromRate));
        const out = new Float32Array(n);
        const scale = fromRate / SR;
        for (let i = 0; i < n; i++) {
            const x = i * scale;
            const i0 = Math.floor(x);
            const f = x - i0;
            const a = input[Math.min(input.length - 1, i0)] || 0;
            const b = input[Math.min(input.length - 1, i0 + 1)] || 0;
            out[i] = a + (b - a) * f;
        }
        return out;
    }

    function onMic(ev) {
        if (!worker || !audioCtx) return;
        const input = ev.inputBuffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < input.length; i += 8) peak = Math.max(peak, Math.abs(input[i]));
        if (peak > ui.mic) ui.mic = ui.mic * 0.7 + peak * 0.3;
        const atRate = resample(input, audioCtx.sampleRate);
        const copy = new Float32Array(atRate.length);
        copy.set(atRate);
        micHold.push(copy);
        micHoldLen += copy.length;
        if (micHoldLen < SR * 0.08) return;
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
        ui.err = "";
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Prohlížeč neumí mikrofon nebo Web Audio");
        }
        try { audioCtx = new AC({ sampleRate: SR }); }
        catch (e) { audioCtx = new AC(); }
        if (audioCtx.state === "suspended") await audioCtx.resume();
        playGain = audioCtx.createGain();
        playGain.gain.value = 0.62;
        playGain.connect(audioCtx.destination);
        bank = bankOf(myId());
        rootPhase = 0;
        seqOk = null;
        lastPose = null;
        ensureWorker();
        micStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
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
        nextAt = audioCtx.currentTime + 0.08;
        pumpTimer = setInterval(pump, 40);
        pump();
        txThisSec = 0;
        rxThisSec = 0;
        statTimer = setInterval(function () {
            if (!enabled) return;
            const who = ui.peer || "nikdo";
            audioLog(
                "vysláno " + txThisSec + "/s " + ui.tx
                + " | mic " + ui.mic.toFixed(3)
                + " C " + ui.e0.toExponential(1)
                + " G " + ui.e1.toExponential(1)
                + " | přijato " + rxThisSec + "/s " + who
            );
            txThisSec = 0;
            rxThisSec = 0;
        }, 1000);
        audioLog("zapnuto, tichá kvinta " + codec().BANKS[bank].name + ", " + Math.round(audioCtx.sampleRate) + " Hz");
        return true;
    }

    function disable() {
        enabled = false;
        window.__audioLinkOn = false;
        if (pumpTimer) clearInterval(pumpTimer);
        if (statTimer) clearInterval(statTimer);
        pumpTimer = null;
        statTimer = null;
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
        if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
        audioCtx = null;
        playGain = null;
        audioLog("vypnuto");
    }

    function syncButton() {
        const btn = document.getElementById("audio-toggle");
        if (!btn) return;
        btn.classList.toggle("on", enabled);
        btn.setAttribute("aria-pressed", enabled ? "true" : "false");
        btn.title = enabled ? "Tichá zvuková síť zapnutá" : "Tichá zvuková síť vypnutá";
    }

    window.queueAudioChat = function () {};

    window.toggleAudioLink = async function () {
        try {
            if (enabled) disable();
            else await enable();
        } catch (err) {
            disable();
            ui.err = (err && err.message) ? err.message : String(err);
            audioLog(ui.err);
        }
        syncButton();
        renderDebug();
        return enabled;
    };

    window.AudioLink = {
        selfTest: function () {
            const C = codec();
            const symbols = C.packPose("on983r1", { x: 400, y: 880, hp: 5, lvl: 2 });
            const pcm = C.encodeFrame(1, symbols, 0).pcm;
            const heard = C.decodeAll(pcm).banks[1];
            const pose = C.unpackPose(heard.symbols);
            const ok = !!(pose && pose.id === "on983r" && pose.x === 400 && pose.y === 880 && pose.hp === 5 && pose.lvl === 2);
            return { ok: ok, pose: pose };
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        const btn = document.getElementById("audio-toggle");
        if (btn) {
            btn.addEventListener("click", function (e) {
                e.preventDefault();
                e.stopPropagation();
                window.toggleAudioLink();
            });
        }
        syncButton();
        renderDebug();
    });
})();
