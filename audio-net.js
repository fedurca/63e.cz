// Acoustic link. Own playback is subtracted from the mic before decode.
(function () {
    const SR = 44100;
    let enabled = false;
    let audioCtx = null;
    let micStream = null;
    let proc = null;
    let playGain = null;
    let worker = null;
    let beaconTimer = null;
    let micHold = [];
    let micHoldLen = 0;
    const tx = new Float32Array(SR);
    let txWrite = 0;
    const peers = new Map();
    const ui = { mic: 0, lagMs: 0, gain: 0, tx: "—", rx: "—", err: "" };

    function myId() {
        return (typeof window.chat_myId === "string" && window.chat_myId) || "local";
    }
    function codec() { return window.AudioCodec; }

    function audioLog(msg) {
        ui.rx = msg;
        if (typeof window.logDebug === "function") window.logDebug("[AUDIO] " + msg, "webrtc", myId());
        renderDebug();
    }

    function renderDebug() {
        const box = document.getElementById("audio-debug");
        if (!box) return;
        box.hidden = !enabled;
        const lines = [
            enabled ? "Zvuková síť: zapnuto" : "Zvuková síť: vypnuto",
            "Mikrofon: " + ui.mic.toFixed(3),
            "Echo: " + ui.lagMs.toFixed(0) + " ms, zisk " + ui.gain.toFixed(2),
            "TX: " + ui.tx,
            "RX: " + ui.rx,
            "Sousedi: " + (peers.size ? Array.from(peers.keys()).join(", ") : "nikdo")
        ];
        if (ui.err) lines.push("Chyba: " + ui.err);
        box.textContent = lines.join("\n");
    }

    function pushTx(pcm) {
        for (let i = 0; i < pcm.length; i++) {
            tx[txWrite] = pcm[i];
            txWrite = (txWrite + 1) % SR;
        }
    }
    function txAt(age) {
        let i = txWrite - 1 - age;
        i %= SR;
        if (i < 0) i += SR;
        return tx[i];
    }

    function cancelEcho(mic) {
        const N = Math.min(480, mic.length);
        const base = mic.length - N;
        let bestLag = 0;
        let best = 0;
        const maxLag = Math.round(SR * 0.09);
        for (let lag = 0; lag <= maxLag; lag += 20) {
            let c = 0;
            for (let i = 0; i < N; i += 6) c += mic[base + i] * txAt(lag + (N - 1 - i));
            if (c > best) { best = c; bestLag = lag; }
        }
        if (best < 0.002) {
            ui.gain = 0;
            ui.lagMs = 0;
            return mic;
        }
        let dot = 0;
        let te = 0;
        for (let i = 0; i < mic.length; i += 2) {
            const t = txAt(bestLag + (mic.length - 1 - i));
            dot += mic[i] * t;
            te += t * t;
        }
        const g = te > 1e-8 ? Math.max(0, Math.min(1.4, dot / te)) : 0;
        const out = new Float32Array(mic.length);
        for (let i = 0; i < mic.length; i++) out[i] = mic[i] - g * txAt(bestLag + (mic.length - 1 - i));
        ui.gain = g;
        ui.lagMs = (bestLag / SR) * 1000;
        return out;
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

    function deliver(parsed) {
        if (!parsed) return;
        if (parsed.type === "peer") {
            if (!parsed.id || parsed.id === myId()) return;
            peers.set(parsed.id, Date.now());
            audioLog("slyším " + parsed.id + " @" + parsed.x + "," + parsed.y);
            if (typeof window.noteAudioPeer === "function") window.noteAudioPeer(parsed.id);
            if (typeof window.ingestAudioPeer === "function") {
                window.ingestAudioPeer(parsed.id, {
                    x: parsed.x, y: parsed.y, lvl: parsed.lvl, hp: parsed.hp,
                    name: parsed.id, flipX: false, anim: "idle"
                });
            }
        } else if (parsed.type === "enemies" && typeof window.ingestAudioEnemies === "function") {
            audioLog("enemy snapshot lvl " + parsed.lvl + " ×" + (parsed.enemies ? parsed.enemies.length : 0));
            window.ingestAudioEnemies(parsed.lvl, parsed.enemies);
        } else if (parsed.type === "chat" && parsed.text) {
            if (!parsed.id || parsed.id === myId()) return;
            peers.set(parsed.id, Date.now());
            audioLog("chat od " + parsed.id + ": " + parsed.text);
            if (typeof window.onAudioChat === "function") window.onAudioChat(parsed.id, parsed.text);
        }
        renderDebug();
    }

    function playPcm(pcm) {
        if (!enabled || !audioCtx || !playGain || !pcm) return;
        pushTx(pcm);
        const buf = audioCtx.createBuffer(1, pcm.length, SR);
        buf.getChannelData(0).set(pcm);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(playGain);
        src.start();
    }

    function ensureWorker() {
        if (worker) return worker;
        worker = new Worker("audio-worker.js?v=1.1.5");
        worker.onmessage = function (e) {
            const msg = e.data || {};
            if (!enabled) return;
            if (msg.type === "pcm") playPcm(msg.pcm);
            else if (msg.type === "packets" && msg.packets) {
                for (let i = 0; i < msg.packets.length; i++) deliver(codec().parsePacket(msg.packets[i]));
            }
        };
        worker.onerror = function (err) {
            ui.err = err && err.message ? err.message : "worker";
            audioLog("worker chyba");
        };
        return worker;
    }

    function sendBytes(bytes, label) {
        ui.tx = label || ("paket " + bytes.length + " B");
        renderDebug();
        ensureWorker().postMessage({ type: "encode", bytes: Array.from(bytes) });
    }

    function beaconNow() {
        if (!enabled || !codec()) return;
        const pose = window.__audioPose || { lvl: 0, x: 0, y: 0, hp: 6 };
        sendBytes(codec().buildBeacon(myId(), pose), "beacon");
        const enemies = window.__audioEnemies;
        if (pose.host && enemies && enemies.length) {
            setTimeout(function () {
                if (enabled) sendBytes(codec().buildEnemies(pose.lvl || 0, enemies), "enemies");
            }, 700);
        }
    }

    window.queueAudioChat = function (text) {
        if (!enabled || !codec() || !text) return;
        sendBytes(codec().buildChat(myId(), text), "chat");
    };

    function onMic(ev) {
        if (!worker || !audioCtx) return;
        const input = ev.inputBuffer.getChannelData(0);
        let peak = 0;
        for (let i = 0; i < input.length; i += 16) peak = Math.max(peak, Math.abs(input[i]));
        ui.mic = ui.mic * 0.8 + peak * 0.2;
        const atRate = resample(input, audioCtx.sampleRate);
        const clean = cancelEcho(atRate);
        const copy = new Float32Array(clean.length);
        copy.set(clean);
        micHold.push(copy);
        micHoldLen += copy.length;
        if (ui.mic > 0.01 && Math.random() < 0.05) renderDebug();
        if (micHoldLen < SR * 0.25) return;
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
        playGain.gain.value = 0.5;
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
        audioLog("zapnuto, vzorkování " + Math.round(audioCtx.sampleRate) + " Hz");
        const slot = (myId().charCodeAt(0) || 0) % 5 * 180;
        setTimeout(beaconNow, slot);
        beaconTimer = setInterval(beaconNow, 2800);
        renderDebug();
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
        if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
        audioCtx = null;
        playGain = null;
        audioLog("vypnuto");
        renderDebug();
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
            const cases = [];
            function check(name, pcm, expectCount, expectFirst) {
                const got = C.decodeAll(pcm).map(function (b) { return Array.from(b); });
                const ok = got.length === expectCount && (!expectFirst || JSON.stringify(got[0]) === JSON.stringify(expectFirst));
                cases.push({ name: name, ok: ok, count: got.length });
                return ok;
            }
            const beacon = C.buildBeacon("ab12cd", { lvl: 3, x: 420, y: 880, hp: 5 });
            let ok = check("clean", C.encodePacket(beacon), 1, beacon);
            const chat = C.buildChat("ab12cd", "ahoj");
            ok = check("chat", C.encodePacket(chat), 1, chat) && ok;
            const parsed = C.parsePacket(Uint8Array.from(chat));
            const parseOk = parsed && parsed.type === "chat" && parsed.text === "ahoj";
            cases.push({ name: "parse-chat", ok: !!parseOk });
            return { ok: ok && !!parseOk, cases: cases };
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
