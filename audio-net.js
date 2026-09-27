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
    let rateTx = 0;
    let rateRx = 0;
    let lastRxAt = 0;
    let micHold = [];
    let micHoldLen = 0;
    const peers = new Map();
    const chatQ = [];
    const chatBuf = {};
    const seenChat = [];
    let chatSeq = 0;
    let remote = null;
    let heardMe = null;
    const ui = {
        mic: 0, e0: 0, e1: 0, tx: "—", rx: "čekám", peer: "", err: "",
        chatIn: 0, chatOut: 0, dir: "vypnuto"
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
        paintHealth();
        const box = document.getElementById("audio-debug");
        if (!box) return;
        box.hidden = !enabled;
        const name = (ui.freq || myFreq()) + " Hz";
        const lines = [
            enabled ? "Akustika " + name + " · " + ui.dir : "Zvuková síť vypnutá",
            "Mic " + ui.mic.toFixed(3) + "  C " + ui.e0.toExponential(1) + "  G " + ui.e1.toExponential(1),
            "TX " + ui.tx,
            "RX " + (ui.peer || "nikdo"),
            "Chat → " + ui.chatOut + "  ← " + ui.chatIn,
            remote ? ("Síť: " + remote.id + " mic " + Number(remote.tune.mic || 0).toFixed(3)
                + " slyší " + (remote.tune.rx || 0) + "/s") : "Síť: ladění čeká"
        ];
        if (ui.err) lines.push(ui.err);
        box.textContent = lines.join("\n");
    }

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function paintHealth() {
        const fresh = remote && Date.now() - remote.at < 4000 ? remote : null;
        let dir = "vypnuto";
        if (enabled) {
            const inbound = !!ui.peer && Date.now() - lastRxAt < 2500;
            const outbound = fresh && fresh.hearsMe;
            if (inbound && outbound) dir = "obousměrně";
            else if (inbound) dir = "jednosměrně k nám";
            else if (outbound) dir = "jednosměrně od nás";
            else if (fresh) dir = "spojeno, tón se nenosí";
            else dir = "vysílám, zpětná vazba není";
        }
        ui.dir = dir;
        setText("ah-dir", dir);
        setText("ah-mic", enabled ? ui.mic.toFixed(3) : "—");
        setText("ah-tx", enabled ? String(rateTx) : "0");
        setText("ah-rx", enabled ? String(rateRx) : "0");
        setText("ah-in", ui.peer || "nikdo");
        setText("ah-out", fresh ? (fresh.hearsMe ? "ano" : "ne") : "neznámo");
        setText("ah-chat-out", String(ui.chatOut));
        setText("ah-chat-in", String(ui.chatIn));
        setText("ah-bands", "2000 " + ui.e0.toExponential(1) + " · 3222 " + ui.e1.toExponential(1));
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
        renderDebug();
    }

    function sameAir(a, b) {
        return String(a || "").toLowerCase().slice(0, 6) === String(b || "").toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 6);
    }

    function mineToken() {
        return String(myId() || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
    }

    function onMorse(r) {
        ui.e0 = r.eLow || 0;
        ui.e1 = r.eHigh || 0;
        ui.snrL = r.snrLow || 0;
        ui.snrH = r.snrHigh || 0;
        ui.hotL = !!r.hotLow;
        ui.hotH = !!r.hotHigh;
        ui.lowText = (r.textLow || "") + (r.morseLow || "");
        ui.highText = (r.textHigh || "") + (r.morseHigh || "");
        ui.partial = (ui.lowText + " | " + ui.highText).slice(-48);
        const lists = [r.packetsLow || [], r.packetsHigh || []];
        for (let p = 0; p < lists.length; p++) {
            for (let i = 0; i < lists[p].length; i++) {
                const pkt = lists[p][i];
                if (!pkt || !pkt.id || pkt.id.slice(0, 6) === mineToken()) continue;
                if (remembered.indexOf(pkt.id) < 0) remembered.push(pkt.id);
                if (pkt.kind === "chat") {
                    const mark = pkt.id + ":" + pkt.text;
                    if (seenChat.indexOf(mark) !== -1) continue;
                    seenChat.push(mark);
                    if (seenChat.length > 20) seenChat.shift();
                    ui.chatIn++;
                    lastRxAt = Date.now();
                    ui.peer = pkt.id;
                    if (typeof window.onAudioChat === "function") window.onAudioChat(pkt.id, pkt.text);
                } else acceptPose(pkt);
            }
        }
        renderDebug();
    }

    function ensureWorker() {
        if (worker) return worker;
        worker = new Worker("audio-worker.js?v=1.1.9");
        worker.onmessage = function (e) {
            if (!enabled) return;
            const msg = e.data || {};
            if (msg.type === "morse") onMorse(msg.report || {});
        };
        worker.onerror = function () { ui.err = "worker"; audioLog("worker chyba"); };
        return worker;
    }

    const remembered = [];
    let playingUntil = 0;
    let playingFreq = 0;
    let liveSrc = null;
    const wav = new Float32Array(SR * 10);
    let wavAt = 0;
    let wavN = 0;

    function otherIds() {
        const ids = remembered.slice();
        const kn = window.chat_knownNodes || {};
        Object.keys(kn).forEach(function (id) { if (id && id !== myId()) ids.push(id); });
        return ids;
    }
    function myFreq() {
        return codec() ? codec().toneFor(myId(), otherIds()) : 2000;
    }
    function pushWav(samples) {
        for (let i = 0; i < samples.length; i++) {
            wav[wavAt] = samples[i];
            wavAt = (wavAt + 1) % wav.length;
        }
        wavN = Math.min(wav.length, wavN + samples.length);
    }
    function wavSnapshot() {
        const n = wavN;
        const out = new Float32Array(n);
        const start = wavN < wav.length ? 0 : wavAt;
        for (let i = 0; i < n; i++) out[i] = wav[(start + i) % wav.length];
        return out;
    }

    function stopTone() {
        if (liveSrc) {
            try { liveSrc.stop(); } catch (e) {}
            liveSrc = null;
        }
        playingUntil = audioCtx ? audioCtx.currentTime : 0;
    }

    function playPcm(pcm, freq) {
        if (!audioCtx || !playGain || !pcm) return;
        const buf = audioCtx.createBuffer(1, pcm.length, SR);
        buf.getChannelData(0).set(pcm);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(playGain);
        const t = Math.max(audioCtx.currentTime + 0.05, playingUntil);
        src.start(t);
        liveSrc = src;
        playingFreq = freq;
        playingUntil = t + pcm.length / SR;
    }

    function pump() {
        if (!enabled || !audioCtx || !codec()) return;
        const C = codec();
        const freq = myFreq();
        ui.freq = freq;
        if (playingFreq && freq !== playingFreq && audioCtx.currentTime < playingUntil) {
            const left = playingFreq;
            stopTone();
            if (worker) worker.postMessage({ type: "forget", freq: left });
            audioLog("přelaďuji z " + left + " Hz na " + freq + " Hz");
        }
        if (audioCtx.currentTime + 0.12 < playingUntil) return;
        const pose = window.__audioPose || { x: 0, y: 0, hp: 6, lvl: 0 };
        let text = "";
        if (chatQ.length) text = C.chatMessage(myId(), chatQ.shift());
        if (!text) text = C.poseMessage(myId(), pose);
        if (!text) return;
        playPcm(C.encodeMorse(text + " " + text, freq), freq);
        txThisSec++;
        ui.tx = text;
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
        pushWav(copy);
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
        playGain.gain.value = 0.85;
        playGain.connect(audioCtx.destination);
        bank = bankOf(myId());
        rootPhase = 0;
        seqOk = null;
        lastPose = null;
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
        nextAt = audioCtx.currentTime + 0.08;
        pumpTimer = setInterval(pump, 250);
        pump();
        txThisSec = 0;
        rxThisSec = 0;
        statTimer = setInterval(function () {
            if (!enabled) return;
            paintHealth();
            const snap = {
                on: true,
                mic: +ui.mic.toFixed(4),
                e0: ui.e0, e1: ui.e1,
                tx: txThisSec, rx: rxThisSec,
                heard: ui.peer || "",
                bank: bank,
                chatIn: ui.chatIn, chatOut: ui.chatOut
            };
            rateTx = txThisSec;
            rateRx = rxThisSec;
            const freq = myFreq();
            const foreignE = freq === 2000 ? ui.e1 : ui.e0;
            const ownE = freq === 2000 ? ui.e0 : ui.e1;
            const foreignSnr = freq === 2000 ? ui.snrH : ui.snrL;
            const foreignHot = freq === 2000 ? ui.hotH : ui.hotL;
            snap.freq = freq;
            snap.foreignE = foreignE;
            snap.ownE = ownE;
            snap.foreignSnr = foreignSnr;
            snap.partial = ui.partial || "";
            if (typeof window.publishAudioTune === "function") window.publishAudioTune(snap);
            const back = remote && Date.now() - remote.at < 4000 ? remote : null;
            const listen = freq === 2000 ? 3222 : 2000;
            const heardTxt = (freq === 2000 ? (ui.highText || "") : (ui.lowText || "")).slice(-24);
            let why = "cizí " + listen + " Hz pod prahem";
            if (rxThisSec) why = "paket přijat";
            else if (foreignHot) why = "nosná " + listen + " Hz «" + (heardTxt || "…") + "»";
            else if ((foreignSnr || 0) > 2) why = "slabý cizí tón snr " + foreignSnr.toFixed(1);
            audioLog(
                "TX " + freq + " Hz " + ui.tx
                + " | poslouchám " + listen + " Hz e " + foreignE.toExponential(1)
                + " snr " + (foreignSnr || 0).toFixed(1)
                + " | vlastní " + freq + " e " + ownE.toExponential(1)
                + " | " + why
                + " | " + ui.dir
                + " | on mě " + (back ? (back.hearsMe ? "slyší" : "neslyší") : "neznámo")
                + " | chat →" + ui.chatOut + " ←" + ui.chatIn
            );
            txThisSec = 0;
            rxThisSec = 0;
        }, 1000);
        audioLog("zapnuto morse " + myFreq() + " Hz, mikrofon " + Math.round(audioCtx.sampleRate) + " Hz");
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
        if (typeof window.publishAudioTune === "function") window.publishAudioTune(null);
        audioLog("vypnuto");
    }

    function syncButton() {
        const btn = document.getElementById("audio-toggle");
        if (!btn) return;
        btn.classList.toggle("on", enabled);
        btn.setAttribute("aria-pressed", enabled ? "true" : "false");
        btn.title = enabled ? "Tichá zvuková síť zapnutá" : "Tichá zvuková síť vypnutá";
    }

    window.queueAudioChat = function (text) {
        if (!enabled || !text) return;
        const clean = String(text).slice(0, 40);
        chatQ.push(clean);
        chatQ.push(clean);
        ui.chatOut++;
        audioLog("chat → " + clean + " (morse, bez čekání na odpověď)");
    };

    window.onAudioTune = function (id, tune) {
        if (!enabled || !tune) return;
        if (tune.on === false) {
            if (remote && remote.id === id) remote = null;
            audioLog(id + " vypnul zvuk");
            renderDebug();
            return;
        }
        if (id && remembered.indexOf(id) < 0) remembered.push(id);
        const mine = myId().toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 6);
        const hearsMe = !!(tune.heard && String(tune.heard).toLowerCase().indexOf(mine) >= 0);
        if (heardMe !== hearsMe) {
            heardMe = hearsMe;
            audioLog(hearsMe ? (id + " mě slyší") : (id + " mě neslyší"));
        }
        remote = { id: id, tune: tune, at: Date.now(), hearsMe: hearsMe };
        renderDebug();
    };

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

    window.downloadMicWav = function () {
        const samples = wavSnapshot();
        if (!samples.length) return;
        const n = samples.length;
        const buf = new ArrayBuffer(44 + n * 2);
        const view = new DataView(buf);
        function ws(off, str) { for (let i = 0; i < str.length; i++) view.setUint8(off + i, str.charCodeAt(i)); }
        ws(0, "RIFF");
        view.setUint32(4, 36 + n * 2, true);
        ws(8, "WAVE");
        ws(12, "fmt ");
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, SR, true);
        view.setUint32(28, SR * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        ws(36, "data");
        view.setUint32(40, n * 2, true);
        let o = 44;
        for (let i = 0; i < n; i++) {
            const x = Math.max(-1, Math.min(1, samples[i] || 0));
            view.setInt16(o, x < 0 ? x * 32768 : x * 32767, true);
            o += 2;
        }
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
        a.download = "63e-mic-10s.wav";
        document.body.appendChild(a);
        a.click();
        a.remove();
    };

    window.AudioLink = {
        selfTest: function () {
            const C = codec();
            const pcm = C.encodeMorse(C.poseMessage("richd7", { x: 400, y: 880, hp: 6, lvl: 1 }), C.FREQ_HIGH);
            const ear = C.createListener();
            ear.push(pcm);
            ear.push(new Float32Array(C.SR));
            const got = ear.poll().packetsHigh[0];
            const ok = !!(got && got.id === "richd7" && got.x === 400 && got.y === 880);
            return { ok: ok, pose: got };
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
        const wavBtn = document.getElementById("btn-save-wav");
        if (wavBtn) wavBtn.addEventListener("click", function (e) {
            e.preventDefault();
            window.downloadMicWav();
        });
        syncButton();
        renderDebug();
    });
})();
