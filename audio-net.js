// Acoustic game link. Data is a quiet kalimba phrase in A minor pentatonic,
// under a soft drone. Off until the player presses the music button.
(function () {
    const SR = 44100;
    const NOTES = [
        220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33,
        659.25, 783.99, 880.00, 1046.50, 1174.66, 1318.51, 1567.98, 1760.00
    ];
    const PREAMBLE = [0, 15, 0, 15, 1, 14];
    const SYMBOL = Math.round(SR * 0.064);
    const GAP = Math.round(SR * 0.012);
    const STEP = SYMBOL + GAP;
    const FILLER = [4, 6, 5, 7, 5, 4];

    function crc8(bytes) {
        let c = 0;
        for (let i = 0; i < bytes.length; i++) {
            c ^= bytes[i];
            for (let b = 0; b < 8; b++) {
                c = (c & 0x80) ? ((c << 1) ^ 0x07) & 255 : (c << 1) & 255;
            }
        }
        return c;
    }

    function renderSymbols(syms) {
        const n = syms.length * STEP + Math.round(SR * 0.08);
        const out = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            const t = i / SR;
            out[i] = 0.03 * Math.sin(2 * Math.PI * 110 * t) + 0.02 * Math.sin(2 * Math.PI * 164.81 * t);
        }
        for (let k = 0; k < syms.length; k++) {
            const f = NOTES[syms[k]] || NOTES[0];
            const start = k * STEP;
            for (let i = 0; i < SYMBOL; i++) {
                const u = i / SYMBOL;
                const env = Math.exp(-1.7 * u) * Math.sin(Math.PI * u);
                out[start + i] += 0.16 * env * Math.sin(2 * Math.PI * f * i / SR);
            }
        }
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
        if (peak > 0.22) {
            const g = 0.22 / peak;
            for (let i = 0; i < n; i++) out[i] *= g;
        }
        return out;
    }

    function encodePacket(bytes) {
        const payload = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
        const crc = crc8(payload);
        const framed = [payload.length, ...payload, crc];
        const syms = PREAMBLE.slice();
        for (let i = 0; i < framed.length; i++) {
            syms.push((framed[i] >> 4) & 15, framed[i] & 15);
        }
        FILLER.forEach(s => syms.push(s));
        return renderSymbols(syms);
    }

    function goertzel(samples, offset, len, freq) {
        const k = Math.round((len * freq) / SR);
        const w = (2 * Math.PI * k) / len;
        const coeff = 2 * Math.cos(w);
        let s0 = 0, s1 = 0, s2 = 0;
        for (let i = 0; i < len; i++) {
            s0 = samples[offset + i] + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        return s1 * s1 + s2 * s2 - coeff * s1 * s2;
    }

    function readSymbol(samples, offset) {
        if (offset < 0 || offset + SYMBOL > samples.length) return -1;
        let best = 0, second = 0, idx = 0;
        for (let n = 0; n < NOTES.length; n++) {
            const p = goertzel(samples, offset, SYMBOL, NOTES[n]);
            if (p > best) { second = best; best = p; idx = n; }
            else if (p > second) second = p;
        }
        if (best < 0.00005 || (second > 0 && best < second * 1.28)) return -1;
        return idx;
    }

    function tryDecodeAt(samples, offset) {
        for (let i = 0; i < PREAMBLE.length; i++) {
            if (readSymbol(samples, offset + i * STEP) !== PREAMBLE[i]) return null;
        }
        let p = offset + PREAMBLE.length * STEP;
        const lenHi = readSymbol(samples, p);
        const lenLo = readSymbol(samples, p + STEP);
        if (lenHi < 0 || lenLo < 0) return null;
        const len = (lenHi << 4) | lenLo;
        if (len < 1 || len > 48) return null;
        p += 2 * STEP;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            const hi = readSymbol(samples, p);
            const lo = readSymbol(samples, p + STEP);
            if (hi < 0 || lo < 0) return null;
            bytes[i] = (hi << 4) | lo;
            p += 2 * STEP;
        }
        const crcHi = readSymbol(samples, p);
        const crcLo = readSymbol(samples, p + STEP);
        if (crcHi < 0 || crcLo < 0) return null;
        if (((crcHi << 4) | crcLo) !== crc8(bytes)) return null;
        return { bytes: bytes, symbols: PREAMBLE.length + (len + 2) * 2 };
    }

    function decodeAll(samples) {
        const found = [];
        const minLen = (PREAMBLE.length + 8) * STEP;
        const hop = Math.floor(STEP / 4);
        for (let off = 0; off + minLen < samples.length;) {
            const pkt = tryDecodeAt(samples, off);
            if (!pkt) { off += hop; continue; }
            found.push(pkt.bytes);
            off += pkt.symbols * STEP;
        }
        return found;
    }

    function u16(n) {
        n = Math.max(0, Math.min(65535, Math.round(n || 0)));
        return [n & 255, (n >> 8) & 255];
    }
    function rd16(b, i) { return b[i] | (b[i + 1] << 8); }

    function buildBeacon(id, pose) {
        const raw = String(id || "").slice(0, 6).padEnd(6, " ");
        const bytes = [1];
        for (let i = 0; i < 6; i++) bytes.push(raw.charCodeAt(i) & 127);
        bytes.push((pose.lvl || 0) & 255);
        u16(pose.x).forEach(v => bytes.push(v));
        u16(pose.y).forEach(v => bytes.push(v));
        bytes.push((pose.hp || 0) & 255);
        return bytes;
    }

    function buildEnemies(lvl, list) {
        const src = (list || []).slice(0, 5);
        const bytes = [2, lvl & 255, src.length];
        src.forEach(e => {
            bytes.push((e.i || 0) & 255);
            u16(e.x).forEach(v => bytes.push(v));
            u16(e.y).forEach(v => bytes.push(v));
        });
        return bytes;
    }

    function parsePacket(bytes) {
        if (!bytes || !bytes.length) return null;
        if (bytes[0] === 1 && bytes.length >= 12) {
            let id = "";
            for (let i = 1; i <= 6; i++) id += String.fromCharCode(bytes[i]);
            return {
                type: "peer",
                id: id.trim(),
                lvl: bytes[7],
                x: rd16(bytes, 8),
                y: rd16(bytes, 10),
                hp: bytes.length > 12 ? bytes[12] : 0
            };
        }
        if (bytes[0] === 2 && bytes.length >= 3) {
            const lvl = bytes[1];
            const n = bytes[2];
            const enemies = [];
            let p = 3;
            for (let i = 0; i < n && p + 5 <= bytes.length; i++) {
                enemies.push({ i: bytes[p], x: rd16(bytes, p + 1), y: rd16(bytes, p + 3) });
                p += 5;
            }
            return { type: "enemies", lvl: lvl, enemies: enemies };
        }
        return null;
    }

    // Fix beacon hp index: layout is type(1) id(6) lvl(1) x(2) y(2) hp(1) = 13 bytes, hp at [12].
    function buildBeaconFixed(id, pose) {
        const bytes = buildBeacon(id, pose);
        return bytes;
    }

    let enabled = false;
    let audioCtx = null;
    let micStream = null;
    let proc = null;
    let playGain = null;
    let heard = [];
    let beaconTimer = null;
    const recentIds = new Map();

    function myId() {
        return (typeof window.chat_myId === "string" && window.chat_myId) || "local";
    }

    function playPcm(pcm) {
        if (!audioCtx || !playGain) return;
        const buf = audioCtx.createBuffer(1, pcm.length, SR);
        buf.getChannelData(0).set(pcm);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        src.connect(playGain);
        src.start();
    }

    function sendBytes(bytes) {
        playPcm(encodePacket(bytes));
    }

    function beaconNow() {
        if (!enabled) return;
        const pose = window.__audioPose || { lvl: 0, x: 0, y: 0, hp: 6 };
        sendBytes(buildBeaconFixed(myId(), pose));
        const enemies = window.__audioEnemies;
        if (pose.host && enemies && enemies.length) {
            setTimeout(() => {
                if (enabled) sendBytes(buildEnemies(pose.lvl || 0, enemies));
            }, 900);
        }
    }

    function deliver(parsed) {
        if (!parsed) return;
        if (parsed.type === "peer") {
            if (!parsed.id || parsed.id === myId()) return;
            recentIds.set(parsed.id, Date.now());
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

    function onMic(ev) {
        const input = ev.inputBuffer.getChannelData(0);
        heard.push(new Float32Array(input));
        let total = 0;
        heard.forEach(c => { total += c.length; });
        const maxKeep = SR * 8;
        while (total > maxKeep && heard.length > 1) total -= heard.shift().length;
        if (total < (PREAMBLE.length + 8) * STEP) return;
        const merged = new Float32Array(total);
        let o = 0;
        heard.forEach(c => { merged.set(c, o); o += c.length; });
        const packets = decodeAll(merged);
        if (!packets.length) return;
        packets.forEach(bytes => deliver(parsePacket(bytes)));
        heard = [merged.slice(Math.max(0, merged.length - SR))];
    }

    async function enable() {
        if (enabled) return true;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Prohlížeč neumí mikrofon nebo Web Audio");
        }
        audioCtx = new AC();
        if (audioCtx.state === "suspended") await audioCtx.resume();
        playGain = audioCtx.createGain();
        playGain.gain.value = 0.42;
        playGain.connect(audioCtx.destination);
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
        if (proc) { proc.onaudioprocess = null; try { proc.disconnect(); } catch (e) {} }
        proc = null;
        if (micStream) micStream.getTracks().forEach(t => t.stop());
        micStream = null;
        if (audioCtx) { try { audioCtx.close(); } catch (e) {} }
        audioCtx = null;
        playGain = null;
        heard = [];
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
        encodePacket: encodePacket,
        decodeAll: decodeAll,
        parsePacket: parsePacket,
        buildBeacon: buildBeaconFixed,
        buildEnemies: buildEnemies,
        selfTest: function () {
            const cases = [];
            function check(name, pcm, expectCount, expectFirst) {
                const got = decodeAll(pcm).map(b => Array.from(b));
                const ok = got.length === expectCount && (!expectFirst || JSON.stringify(got[0]) === JSON.stringify(expectFirst));
                cases.push({ name: name, ok: ok, count: got.length, first: got[0] || null });
                return ok;
            }
            const beacon = buildBeaconFixed("ab12cd", { lvl: 3, x: 420, y: 880, hp: 5 });
            let ok = check("clean", encodePacket(beacon), 1, beacon);

            const noisy = encodePacket(beacon);
            for (let i = 0; i < noisy.length; i++) noisy[i] += (Math.random() * 2 - 1) * 0.012;
            ok = check("noise", noisy, 1, beacon) && ok;

            const enemies = buildEnemies(1, [{ i: 2, x: 100, y: 200 }, { i: 4, x: 1500, y: 900 }]);
            ok = check("enemies", encodePacket(enemies), 1, enemies) && ok;

            const broken = encodePacket(beacon);
            broken[Math.floor(broken.length / 2)] += 0.35;
            const brokenGot = decodeAll(broken);
            const brokenOk = brokenGot.length === 0 || Array.from(brokenGot[0]).join(",") === beacon.join(",");
            cases.push({ name: "corrupt-or-drop", ok: brokenOk, count: brokenGot.length });
            ok = brokenOk && ok;

            const parsed = parsePacket(Uint8Array.from(beacon));
            const parseOk = parsed && parsed.type === "peer" && parsed.id === "ab12cd" && parsed.x === 420 && parsed.y === 880 && parsed.lvl === 3 && parsed.hp === 5;
            cases.push({ name: "parse", ok: !!parseOk });
            ok = parseOk && ok;
            return { ok: ok, cases: cases };
        }
    };

    document.addEventListener("DOMContentLoaded", () => {
        const btn = document.getElementById("audio-toggle");
        if (!btn) return;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.toggleAudioLink();
        });
        syncButton();
    });
})();
